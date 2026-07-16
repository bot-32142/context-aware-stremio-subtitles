const fs = require("node:fs/promises");
const path = require("node:path");
const { contextweaveConfigFingerprint } = require("./contextweaveCli");
const { getContextWeaveTargetLanguage } = require("./languages");
const { mediaBookName, mediaContextKey, mediaTranslationKey } = require("./media");
const { sha256, sha256Buffer } = require("./hash");
const { detectSubtitleFormat, normalizeSubtitleFormat } = require("./subtitleFormat");
const { errorSubtitle, loadingSubtitle } = require("./subtitleMessages");

class TranslationManager {
  constructor({ config, provider, registry, contextweaveCli }) {
    this.config = config;
    this.provider = provider;
    this.registry = registry;
    this.contextweaveCli = contextweaveCli;
    this.inFlight = new Map();
    this.bookLocks = new Map();
  }

  async requestTranslation({ sourceFileId, targetLanguage, mediaInfo, filename = "", sourceLanguage = "" }) {
    const registryKey = mediaContextKey(mediaInfo, targetLanguage);
    const translationKey = mediaTranslationKey(mediaInfo, targetLanguage);
    const fingerprint = await contextweaveConfigFingerprint(this.config.contextweaveConfig);
    const requestKey = this._requestKey({ translationKey });
    const cachedByRequest = await this._readCachedByRequestKey(requestKey);
    if (cachedByRequest) {
      return { state: "complete", content: cachedByRequest.content, format: cachedByRequest.format, cacheKey: cachedByRequest.cacheKey };
    }

    if (this.inFlight.has(requestKey)) {
      return { state: "loading", content: loadingSubtitle(), format: "srt", cacheKey: requestKey };
    }

    const recentError = await this._consumeError(requestKey);
    if (recentError) {
      return { state: "error", content: errorSubtitle(recentError), format: "srt", cacheKey: requestKey };
    }

    const job = this._downloadAndRunTranslationJob({
      requestKey,
      sourceFileId,
      targetLanguage,
      mediaInfo,
        filename,
        sourceLanguage,
        registryKey,
        translationKey,
        fingerprint
      });
    this.inFlight.set(requestKey, job);
    job.finally(() => this.inFlight.delete(requestKey)).catch(() => {});
    return { state: "loading", content: loadingSubtitle(), format: "srt", cacheKey: requestKey };
  }

  async _downloadAndRunTranslationJob(jobBase) {
    try {
      const downloaded = await this.provider.download(jobBase.sourceFileId, { languageHint: jobBase.sourceLanguage });
      const sourceContent = downloaded.content;
      const format = normalizeSubtitleFormat(downloaded.format || detectSubtitleFormat(sourceContent));
      const sourceHash = sha256Buffer(Buffer.from(sourceContent, "utf8"));
      const reusable = await this._recoverCachedBySourceHash({
        requestKey: jobBase.requestKey,
        registryKey: jobBase.registryKey,
        translationKey: jobBase.translationKey,
        targetLanguage: jobBase.targetLanguage,
        sourceHash,
        fingerprint: jobBase.fingerprint
      });
      if (reusable) return;

      const cacheKey = sha256(
        `${jobBase.translationKey}:${format}`
      );
      const cached = await this._readCachedTranslation(cacheKey, format);
      if (cached) {
        await this._writeCacheMetadata(jobBase.requestKey, {
          cacheKey,
          format: cached.format,
          translationKey: jobBase.translationKey,
          sourceHash,
          sourceFileId: jobBase.sourceFileId,
          sourceLanguage: jobBase.sourceLanguage,
          registryKey: jobBase.registryKey,
          targetLanguage: jobBase.targetLanguage,
          fingerprint: jobBase.fingerprint
        });
        return;
      }

      await this._runTranslationJob({
        ...jobBase,
        cacheKey,
        sourceContent,
        format,
        finalPath: this._finalPath(cacheKey, format)
      });
      await this._writeCacheMetadata(jobBase.requestKey, {
        cacheKey,
        format,
        translationKey: jobBase.translationKey,
        sourceHash,
        sourceFileId: jobBase.sourceFileId,
        sourceLanguage: jobBase.sourceLanguage,
        registryKey: jobBase.registryKey,
        targetLanguage: jobBase.targetLanguage,
        fingerprint: jobBase.fingerprint
      });
    } catch (error) {
      await this._writeError(jobBase.requestKey, error);
    }
  }

  async _runTranslationJob(job) {
    await fs.mkdir(this.config.tmpDir, { recursive: true });
    await fs.mkdir(this.config.translationDir, { recursive: true });
    const inputPath = path.join(this.config.tmpDir, `${job.cacheKey}.input.${job.format}`);
    const outputPath = path.join(this.config.tmpDir, `${job.cacheKey}.output.${job.format}`);
    await fs.writeFile(inputPath, job.sourceContent, "utf8");

    try {
      await this._withBookLock(job.registryKey, async () => {
        const registryEntry = await this._resolveRegistryEntry(job);
        const bookName = mediaBookName(job.mediaInfo, job.targetLanguage, job.filename);
        try {
          const data = await this.contextweaveCli.run({
            inputPath,
            outputPath,
            format: job.format,
            bookId: registryEntry?.bookId || "",
            bookName: registryEntry ? "" : bookName
          });
          await this._rememberBook(job, registryEntry, data.book_id || data.project_id || "");
        } catch (error) {
          await this._rememberBook(job, registryEntry, error.bookId || error.projectId || error.details?.book_id || error.details?.project_id || "");
          if (!registryEntry?.bookId || !isDuplicateImportError(error)) throw error;

          // ContextWeave v1 cannot rerun an input already imported into a book.
          // Roll over to a fresh book so retries can make progress again.
          try {
            const data = await this.contextweaveCli.run({
              inputPath,
              outputPath,
              format: job.format,
              bookId: "",
              bookName
            });
            await this._rememberBook(job, null, data.book_id || data.project_id || "");
          } catch (retryError) {
            await this._rememberBook(
              job,
              null,
              retryError.bookId || retryError.projectId || retryError.details?.book_id || retryError.details?.project_id || ""
            );
            throw retryError;
          }
        }
      });

      const translated = await fs.readFile(outputPath, "utf8");
      if (!translated.trim()) throw new Error("contextweave-cli produced an empty subtitle file.");
      await fs.mkdir(path.dirname(job.finalPath), { recursive: true });
      await fs.writeFile(job.finalPath, translated, "utf8");
    } finally {
      await fs.rm(inputPath, { force: true });
      await fs.rm(outputPath, { force: true });
    }
  }

  async waitForAll() {
    await Promise.allSettled([...this.inFlight.values()]);
  }

  async _resolveRegistryEntry(job) {
    const existing = await this.registry.get(job.registryKey);
    if (isReusableRegistryEntry(existing, job.fingerprint)) return existing;

    const recovered = await this._recoverBookFromCatLibrary(job);
    if (isReusableRegistryEntry(recovered, job.fingerprint)) return recovered;
    return null;
  }

  async _recoverBookFromCatLibrary(job) {
    if (typeof this.contextweaveCli.listBooks !== "function") return null;

    try {
      const books = await this.contextweaveCli.listBooks();
      const targetLanguageName = this.config.targetLanguageNames?.[job.targetLanguage] || job.targetLanguage;
      const candidate = selectReusableBook(books, job.mediaInfo, job.targetLanguage, targetLanguageName);
      if (!candidate?.bookId) return null;
      return await this.registry.set(job.registryKey, {
        bookId: candidate.bookId,
        bookName: candidate.bookName,
        targetLanguage: job.targetLanguage,
        mediaRootId: job.mediaInfo.rootId,
        mediaType: job.mediaInfo.type,
        contextweaveConfigFingerprint: job.fingerprint,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString()
      });
    } catch (_error) {
      return null;
    }
  }

  async _rememberBook(job, existingEntry, bookId) {
    if (existingEntry) {
      await this.registry.touch(job.registryKey);
      return existingEntry;
    }

    if (!bookId) return null;
    return this.registry.set(job.registryKey, {
      bookId,
      bookName: mediaBookName(job.mediaInfo, job.targetLanguage, job.filename),
      targetLanguage: job.targetLanguage,
      mediaRootId: job.mediaInfo.rootId,
      mediaType: job.mediaInfo.type,
      contextweaveConfigFingerprint: job.fingerprint,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString()
    });
  }

  async _withBookLock(key, fn) {
    const previous = this.bookLocks.get(key) || Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    this.bookLocks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.bookLocks.get(key) === tail) this.bookLocks.delete(key);
    }
  }

  _requestKey({ translationKey }) {
    return sha256(translationKey);
  }

  _finalPath(cacheKey, format) {
    return path.join(this.config.translationDir, `${cacheKey}.${normalizeSubtitleFormat(format)}`);
  }

  _metadataPath(requestKey) {
    return path.join(this.config.translationDir, `${requestKey}.metadata.json`);
  }

  _errorPath(requestKey) {
    return path.join(this.config.translationDir, `${requestKey}.error.json`);
  }

  async _readCachedByRequestKey(requestKey) {
    const metadata = await readJsonIfExists(this._metadataPath(requestKey));
    if (!metadata?.cacheKey || !metadata?.format) return null;
    const cached = await this._readCachedTranslation(metadata.cacheKey, metadata.format);
    if (!cached) return null;
    return { ...cached, cacheKey: metadata.cacheKey };
  }

  async _writeCacheMetadata(requestKey, metadata) {
    await fs.mkdir(this.config.translationDir, { recursive: true });
    await fs.writeFile(
      this._metadataPath(requestKey),
      `${JSON.stringify({ ...metadata, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8"
    );
  }

  async _writeError(requestKey, error) {
    await fs.mkdir(this.config.translationDir, { recursive: true });
    await fs.writeFile(
      this._errorPath(requestKey),
      `${JSON.stringify({ message: error?.message || "Translation failed.", createdAt: Date.now() }, null, 2)}\n`,
      "utf8"
    );
  }

  async _consumeError(requestKey) {
    const errorPath = this._errorPath(requestKey);
    const payload = await readJsonIfExists(errorPath);
    if (!payload?.message) return "";
    await fs.rm(errorPath, { force: true });
    return payload.message;
  }

  async _readCachedTranslation(cacheKey, format) {
    const candidates = [normalizeSubtitleFormat(format), "srt"];
    for (const candidate of [...new Set(candidates)]) {
      const content = await readTextIfExists(this._finalPath(cacheKey, candidate));
      if (content) return { content, format: candidate };
    }
    return null;
  }

  async _recoverCachedBySourceHash({ requestKey, registryKey, translationKey, targetLanguage, sourceHash, fingerprint }) {
    const entries = await listMetadataFiles(this.config.translationDir);
    for (const entry of entries) {
      const metadata = await readJsonIfExists(path.join(this.config.translationDir, entry));
      if (!metadata?.cacheKey || !metadata?.format) continue;
      if (metadata.translationKey && metadata.translationKey !== translationKey) continue;
      if (metadata.registryKey !== registryKey) continue;
      if (metadata.targetLanguage !== targetLanguage) continue;
      if (metadata.sourceHash !== sourceHash) continue;

      const cached = await this._readCachedTranslation(metadata.cacheKey, metadata.format);
      if (!cached) continue;

      await this._writeCacheMetadata(requestKey, {
        cacheKey: metadata.cacheKey,
        format: cached.format,
        translationKey,
        sourceHash,
        registryKey,
        targetLanguage,
        fingerprint
      });
      return { ...cached, cacheKey: metadata.cacheKey };
    }
    return null;
  }
}

async function listMetadataFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.filter(entry => entry.endsWith(".metadata.json"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  const text = await readTextIfExists(filePath);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

module.exports = {
  TranslationManager
};

function isReusableRegistryEntry(entry, fingerprint) {
  if (!entry?.bookId) return false;
  const entryFingerprint = entry.contextweaveConfigFingerprint || entry.catConfigFingerprint || "";
  if (entryFingerprint && entryFingerprint !== fingerprint) return false;
  return true;
}

function selectReusableBook(books, mediaInfo, targetLanguage, targetLanguageName) {
  const expectedBookName = mediaBookName(mediaInfo, targetLanguage, "");
  const expectedTargetLanguage = getContextWeaveTargetLanguage(targetLanguageName);
  const matches = books
    .map(item => toReusableBookCandidate(item, expectedBookName))
    .filter(
      candidate =>
        candidate.targetLanguage === expectedTargetLanguage &&
        matchesMediaContext(candidate, mediaInfo, targetLanguage, expectedBookName)
    )
    .sort(compareReusableBooks);
  return matches[0] || null;
}

function toReusableBookCandidate(item, expectedBookName) {
  const bookId = String(item?.project?.project_id || "");
  const bookName = String(item?.project?.name || "");
  const progress = parseProgressSummary(item?.progress_summary);
  return {
    bookId,
    bookName,
    targetLanguage: String(item?.target_language || ""),
    exactNameMatch: bookName === expectedBookName,
    translatedChunks: progress.translatedChunks,
    totalChunks: progress.totalChunks,
    modifiedAt: Number(item?.modified_at || 0)
  };
}

function matchesMediaContext(candidate, mediaInfo, targetLanguage, expectedBookName) {
  if (!candidate.bookId || !candidate.bookName) return false;
  const suffix = ` -> ${targetLanguage}`;
  const prefix = expectedBookName.endsWith(suffix) ? expectedBookName.slice(0, -suffix.length) : expectedBookName;
  return candidate.bookName === expectedBookName || (candidate.bookName.startsWith(`${prefix} (`) && candidate.bookName.endsWith(suffix));
}

function parseProgressSummary(value) {
  const match = /^(\d+)\s*\/\s*(\d+)\s+translated$/i.exec(String(value || "").trim());
  if (!match) return { translatedChunks: 0, totalChunks: 0 };
  return {
    translatedChunks: Number.parseInt(match[1], 10),
    totalChunks: Number.parseInt(match[2], 10)
  };
}

function compareReusableBooks(left, right) {
  return (
    Number(right.exactNameMatch) - Number(left.exactNameMatch) ||
    right.translatedChunks - left.translatedChunks ||
    right.totalChunks - left.totalChunks ||
    right.modifiedAt - left.modifiedAt ||
    left.bookId.localeCompare(right.bookId)
  );
}

function isDuplicateImportError(error) {
  const importedCount = Number(error?.details?.imported_count);
  if (importedCount !== 0) return false;
  return (
    error?.code === "unsupported_import" ||
    error?.message === "contextweave-cli run expects exactly one imported document in v1."
  );
}
