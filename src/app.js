const express = require("express");
const path = require("node:path");
const { BookRegistry } = require("./bookRegistry");
const { CatCli } = require("./catCli");
const { getLanguageName, normalizeLanguageCode } = require("./languages");
const { mediaContextKey, parseStremioId } = require("./media");
const { OpenSubtitlesV3Provider } = require("./openSubtitlesV3");
const { contentTypeForFormat } = require("./subtitleFormat");
const { TranslationManager } = require("./translationManager");
const { resolveBaseUrl } = require("./config");

function createApp({ config, provider, registry, catCli, translationManager } = {}) {
  if (!config) throw new Error("createApp requires config.");
  const app = express();
  app.disable("x-powered-by");

  const resolvedProvider = provider || new OpenSubtitlesV3Provider({ timeoutMs: config.providerTimeoutMs });
  const resolvedRegistry = registry || new BookRegistry(path.join(config.dataDir, "book-registry.json"));
  const resolvedCatCli =
    catCli ||
    new CatCli({
      command: config.catCliCommand,
      libraryRoot: config.catLibraryRoot,
      configPath: config.catConfig
    });
  const translator =
    translationManager ||
    new TranslationManager({
      config,
      provider: resolvedProvider,
      registry: resolvedRegistry,
      catCli: resolvedCatCli
    });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/logo.png", (_req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.send(LOGO_PNG);
  });

  app.get("/manifest.json", (req, res) => {
    const baseUrl = resolveBaseUrl(req, config.baseUrl);
    res.json(buildManifest(config, baseUrl));
  });

  app.get("/subtitles/:type/:id.json", async (req, res) => {
    return handleSubtitles(req, res, { config, provider: resolvedProvider });
  });

  app.get("/subtitles/:type/:id/:extra.json", async (req, res) => {
    return handleSubtitles(req, res, { config, provider: resolvedProvider });
  });

  app.get("/subtitle/:fileId/:language", async (req, res) => {
    try {
      const downloaded = await resolvedProvider.download(req.params.fileId);
      setNoStore(res);
      res.setHeader("Content-Type", contentTypeForFormat(downloaded.format));
      res.setHeader("Content-Disposition", `attachment; filename="${safeName(req.params.fileId)}.${downloaded.format}"`);
      res.send(downloaded.content);
    } catch (error) {
      res.status(404).type("text/plain").send(error.message || "Subtitle not found.");
    }
  });

  app.get("/translate/:sourceFileId/:targetLang", async (req, res) => {
    try {
      const mediaInfo = parseStremioId(req.query.type || "movie", req.query.id || "");
      if (!mediaInfo) {
        res.status(400).type("text/plain").send("Missing or unsupported media id for translation.");
        return;
      }
      const targetLanguage = normalizeLanguageCode(req.params.targetLang);
      const result = await translator.requestTranslation({
        sourceFileId: req.params.sourceFileId,
        targetLanguage,
        mediaInfo,
        filename: req.query.filename || ""
      });
      setNoStore(res);
      res.setHeader("Content-Type", contentTypeForFormat(result.format));
      const filenamePrefix =
        result.state === "complete" ? "translated" : result.state === "error" ? "translation_error" : "translating";
      res.setHeader("Content-Disposition", `attachment; filename="${filenamePrefix}_${targetLanguage}.${result.format}"`);
      res.send(result.content);
    } catch (error) {
      res.status(500).type("text/plain").send(error.message || "Translation failed.");
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.locals.translationManager = translator;
  return app;
}

async function handleSubtitles(req, res, { config, provider }) {
  const mediaInfo = parseStremioId(req.params.type, req.params.id);
  if (!mediaInfo) {
    res.json({ subtitles: [] });
    return;
  }

  const extras = parseExtras(req);
  const baseUrl = resolveBaseUrl(req, config.baseUrl);
  const searchLanguages = [...new Set([...config.sourceLanguages, ...config.targetLanguages])];
  let found = [];
  try {
    found = await provider.search(mediaInfo, searchLanguages);
  } catch (_error) {
    found = [];
  }
  const ranked = rankAndLimitSubtitles(found, {
    filename: extras.filename || "",
    maxPerLanguage: config.maxSubtitlesPerLanguage
  });

  const directEntries = ranked.map(subtitle => ({
    id: subtitle.fileId,
    lang: subtitle.languageCode,
    url: `${baseUrl}/subtitle/${encodeURIComponent(subtitle.fileId)}/${encodeURIComponent(subtitle.languageCode)}`
  }));

  const sourceLangs = new Set(config.sourceLanguages.map(normalizeLanguageCode));
  const translationEntries = [];
  const sourceSubtitles = ranked.filter(subtitle => sourceLangs.has(subtitle.languageCode));
  for (const targetLanguage of config.targetLanguages) {
    const targetName = getLanguageName(targetLanguage);
    for (const subtitle of sourceSubtitles) {
      const url = new URL(`${baseUrl}/translate/${encodeURIComponent(subtitle.fileId)}/${encodeURIComponent(targetLanguage)}`);
      url.searchParams.set("type", req.params.type);
      url.searchParams.set("id", req.params.id);
      if (extras.filename) url.searchParams.set("filename", extras.filename);
      url.searchParams.set("sourceLang", subtitle.languageCode);
      translationEntries.push({
        id: `translate_${subtitle.fileId}_to_${targetLanguage}`,
        lang: `Make ${targetName}`,
        url: url.toString()
      });
    }
  }

  res.json({ subtitles: [...directEntries, ...translationEntries] });
}

function buildManifest(config, baseUrl) {
  return {
    id: config.addonId,
    version: "0.1.0",
    name: config.addonName,
    description: `Fetch subtitles and translate them locally with cat-cli. Sources: ${config.sourceLanguages.join(", ")}. Targets: ${config.targetLanguages.join(", ")}.`,
    resources: ["subtitles"],
    types: ["movie", "series", "anime"],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    },
    logo: `${baseUrl}/logo.png`
  };
}

function parseExtras(req) {
  const extras = { ...req.query };
  const rawExtra = String(req.params.extra || "");
  if (rawExtra) {
    for (const part of rawExtra.split("&")) {
      const [key, value = ""] = part.split("=");
      if (key) extras[decodeURIComponent(key)] = decodeURIComponent(value);
    }
  }
  return extras;
}

function rankAndLimitSubtitles(subtitles, { filename, maxPerLanguage }) {
  const scored = subtitles
    .map((subtitle, index) => ({
      subtitle,
      index,
      score: scoreSubtitle(subtitle, filename)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const counts = new Map();
  const limited = [];
  for (const item of scored) {
    const lang = item.subtitle.languageCode;
    const count = counts.get(lang) || 0;
    if (count >= maxPerLanguage) continue;
    counts.set(lang, count + 1);
    limited.push(item.subtitle);
  }
  return limited;
}

function scoreSubtitle(subtitle, filename) {
  const haystack = `${subtitle.name || ""} ${subtitle.downloadLink || ""}`.toLowerCase();
  const tokens = String(filename || "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3);
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function safeName(value) {
  return String(value || "subtitle").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "subtitle";
}

const LOGO_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

module.exports = {
  buildManifest,
  createApp,
  mediaContextKey,
  rankAndLimitSubtitles
};
