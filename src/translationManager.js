const fs = require("node:fs/promises");
const path = require("node:path");
const { catConfigFingerprint } = require("./catCli");
const { mediaBookName, mediaContextKey } = require("./media");
const { sha256, sha256Buffer } = require("./hash");
const { detectSubtitleFormat, normalizeSubtitleFormat } = require("./subtitleFormat");
const { errorSubtitle, loadingSubtitle } = require("./subtitleMessages");

class TranslationManager {
  constructor({ config, provider, registry, catCli }) {
    this.config = config;
    this.provider = provider;
    this.registry = registry;
    this.catCli = catCli;
    this.inFlight = new Map();
    this.bookLocks = new Map();
  }

  async requestTranslation({ sourceFileId, targetLanguage, mediaInfo, filename = "", sourceLanguage = "" }) {
    const registryKey = mediaContextKey(mediaInfo, targetLanguage);
    const fingerprint = await catConfigFingerprint(this.config.catConfig);
    const requestKey = this._requestKey({ registryKey, sourceFileId, targetLanguage, fingerprint });
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
      const cacheKey = sha256(
        `${jobBase.registryKey}:${jobBase.sourceFileId}:${jobBase.targetLanguage}:${sourceHash}:${jobBase.fingerprint}:${format}`
      );
      const cached = await this._readCachedTranslation(cacheKey, format);
      if (cached) {
        await this._writeCacheMetadata(jobBase.requestKey, {
          cacheKey,
          format: cached.format,
          sourceHash,
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
        sourceHash,
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
        try {
          const data = await this.catCli.run({
            inputPath,
            outputPath,
            format: job.format,
            bookId: registryEntry?.bookId || "",
            bookName: registryEntry ? "" : mediaBookName(job.mediaInfo, job.targetLanguage, job.filename)
          });
          await this._rememberBook(job, registryEntry, data.book_id || data.project_id || "");
        } catch (error) {
          await this._rememberBook(job, registryEntry, error.bookId || error.projectId || error.details?.book_id || error.details?.project_id || "");
          throw error;
        }
      });

      const translated = await fs.readFile(outputPath, "utf8");
      if (!translated.trim()) throw new Error("cat-cli produced an empty subtitle file.");
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
    if (typeof this.catCli.listBooks !== "function") return null;

    try {
      const books = await this.catCli.listBooks();
      const candidate = selectReusableBook(books, job.mediaInfo, job.targetLanguage);
      if (!candidate?.bookId) return null;
      return await this.registry.set(job.registryKey, {
        bookId: candidate.bookId,
        bookName: candidate.bookName,
        targetLanguage: job.targetLanguage,
        mediaRootId: job.mediaInfo.rootId,
        mediaType: job.mediaInfo.type,
        catConfigFingerprint: job.fingerprint,
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
      catConfigFingerprint: job.fingerprint,
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

  _requestKey({ registryKey, sourceFileId, targetLanguage, fingerprint }) {
    return sha256(`${registryKey}:${sourceFileId}:${targetLanguage}:${fingerprint}`);
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
  if (entry.catConfigFingerprint && entry.catConfigFingerprint !== fingerprint) return false;
  return true;
}

function selectReusableBook(books, mediaInfo, targetLanguage) {
  const expectedBookName = mediaBookName(mediaInfo, targetLanguage, "");
  const matches = books
    .map(item => toReusableBookCandidate(item, expectedBookName))
    .filter(candidate => matchesMediaContext(candidate, mediaInfo, targetLanguage, expectedBookName))
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
