const express = require("express");
const path = require("node:path");
const { BookRegistry } = require("./bookRegistry");
const { ContextweaveCli } = require("./contextweaveCli");
const { normalizeLanguageCode } = require("./languages");
const log = require("./logger");
const { mediaContextKey, parseStremioId } = require("./media");
const { ProviderManager } = require("./providers");
const { finalizeSubtitleResults, rankAndLimitSubtitles } = require("./subtitleRanking");
const { contentTypeForFormat, normalizeSubtitleFormat } = require("./subtitleFormat");
const { TranslationManager } = require("./translationManager");
const { resolveBaseUrl } = require("./config");

function createApp({ config, provider, registry, contextweaveCli, translationManager } = {}) {
  if (!config) throw new Error("createApp requires config.");
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Type, Content-Disposition, Cache-Control");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const resolvedProvider = provider || new ProviderManager({ config });
  const resolvedRegistry = registry || new BookRegistry(path.join(config.dataDir, "book-registry.json"));
  const resolvedContextweaveCli =
    contextweaveCli ||
    new ContextweaveCli({
      command: config.contextweaveCliCommand,
      libraryRoot: config.contextweaveLibraryRoot,
      configPath: config.contextweaveConfig,
      noPolish: config.contextweaveNoPolish
    });
  const translator =
    translationManager ||
    new TranslationManager({
      config,
      provider: resolvedProvider,
      registry: resolvedRegistry,
      contextweaveCli: resolvedContextweaveCli
    });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/", (_req, res) => {
    res.redirect(302, "/manifest.json");
  });

  app.get("/help", (req, res) => {
    const baseUrl = resolveBaseUrl(req, config.baseUrl);
    res.type("text/plain").send([
      config.addonName,
      "",
      `Manifest: ${baseUrl}/manifest.json`,
      `Health: ${baseUrl}/healthz`,
      `Translation: ${config.translationEnabled ? "enabled" : "disabled until ContextWeave is configured"}`,
      "",
      "Install the manifest URL in Stremio to use this addon."
    ].join("\n"));
  });

  app.get("/logo.png", (_req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.send(LOGO_PNG);
  });

  app.get("/manifest.json", (req, res) => {
    const baseUrl = resolveBaseUrl(req, config.baseUrl);
    setNoStore(res);
    res.json(buildManifest(config, baseUrl));
  });

  app.get("/subtitles/:type/:id.json", async (req, res) => {
    try {
      await handleSubtitles(req, res, { config, provider: resolvedProvider });
    } catch (error) {
      log.warn(() => `[Route] subtitles ${req.params.type}/${req.params.id} failed: ${error.message}`);
      res.json({ subtitles: [] });
    }
  });

  app.get("/subtitles/:type/:id/:extra.json", async (req, res) => {
    try {
      await handleSubtitles(req, res, { config, provider: resolvedProvider });
    } catch (error) {
      log.warn(() => `[Route] subtitles ${req.params.type}/${req.params.id} failed: ${error.message}`);
      res.json({ subtitles: [] });
    }
  });

  app.get("/subtitle/:fileId/:language", async (req, res) => {
    try {
      const language = stripSubtitleFormatSuffix(req.params.language);
      const downloaded = await resolvedProvider.download(req.params.fileId, { languageHint: language });
      setNoStore(res);
      res.setHeader("Content-Type", contentTypeForFormat(downloaded.format));
      res.setHeader("Content-Disposition", `attachment; filename="${safeName(req.params.fileId)}.${downloaded.format}"`);
      res.send(downloaded.content);
    } catch (error) {
      res.status(404).type("text/plain").send(error.message || "Subtitle not found.");
    }
  });

  app.get("/translate/:sourceFileId/:targetLang", async (req, res) => {
    if (!config.translationEnabled) {
      res.status(503).type("text/plain").send("Translation is disabled. Set ENABLE_TRANSLATION=true and configure CONTEXTWEAVE_CLI_CMD/CONTEXTWEAVE_CONFIG.");
      return;
    }
    try {
      const mediaInfo = parseStremioId(req.query.type || "movie", req.query.id || "");
      if (!mediaInfo) {
        res.status(400).type("text/plain").send("Missing or unsupported media id for translation.");
        return;
      }
      const targetLanguage = normalizeLanguageCode(stripSubtitleFormatSuffix(req.params.targetLang));
      const result = await translator.requestTranslation({
        sourceFileId: req.params.sourceFileId,
        targetLanguage,
        mediaInfo,
        filename: req.query.filename || "",
        sourceLanguage: req.query.sourceLang || ""
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
  const requestedLanguages = [...new Set([...config.sourceLanguages, ...config.targetLanguages])];
  const searchLanguages = config.translationEnabled ? [] : requestedLanguages;
  let found = [];
  try {
    found = await provider.search(mediaInfo, searchLanguages, extras);
  } catch (_error) {
    found = [];
  }
  const ranked = finalizeSubtitleResults(found, searchLanguages, config, {
    filename: extras.filename || "",
  });

  const sourceLangs = new Set(config.sourceLanguages.map(normalizeLanguageCode));
  const targetLangs = new Set(config.targetLanguages.map(normalizeLanguageCode));
  const targetSubtitles = ranked.filter(subtitle => targetLangs.has(normalizeLanguageCode(subtitle.languageCode)));
  const directSubtitles = config.translationEnabled ? targetSubtitles : ranked;
  const directEntries = directSubtitles.map(subtitle => ({
    id: subtitle.fileId,
    lang: subtitleListLabel(subtitle),
    url: `${baseUrl}/subtitle/${encodeURIComponent(subtitle.fileId)}/${encodeURIComponent(subtitle.languageCode)}.${subtitleUrlFormat(subtitle)}`
  }));

  const directTargetLangs = new Set(targetSubtitles.map(subtitle => normalizeLanguageCode(subtitle.languageCode)));
  const translationEntries = [];
  if (config.translationEnabled) {
    const sourceSubtitles = ranked.filter(subtitle => sourceLangs.has(normalizeLanguageCode(subtitle.languageCode)));
    const translationSource = sourceSubtitles.length
      ? sourceSubtitles
      : ranked.filter(subtitle => !targetLangs.has(normalizeLanguageCode(subtitle.languageCode))).slice(0, 1);
    for (const targetLanguage of config.targetLanguages) {
      if (directTargetLangs.has(normalizeLanguageCode(targetLanguage))) continue;
      const subtitle = translationSource[0];
      if (!subtitle) continue;
      const url = new URL(`${baseUrl}/translate/${encodeURIComponent(subtitle.fileId)}/${encodeURIComponent(targetLanguage)}.${subtitleUrlFormat(subtitle)}`);
      url.searchParams.set("type", req.params.type);
      url.searchParams.set("id", req.params.id);
      if (extras.filename) url.searchParams.set("filename", extras.filename);
      url.searchParams.set("sourceLang", subtitle.languageCode);
      translationEntries.push({
        id: `translate_${req.params.type}_${req.params.id}_to_${targetLanguage}`,
        lang: translatedSubtitleLang(targetLanguage),
        url: url.toString()
      });
    }
  }

  setNoStore(res);
  res.json({ subtitles: [...directEntries, ...translationEntries] });
}

function buildManifest(config, baseUrl) {
  const modeDescription = config.translationEnabled
    ? `Fetch subtitles and translate them locally with contextweave-cli. Sources: ${config.sourceLanguages.join(", ")}. Targets: ${config.targetLanguages.join(", ")}.`
    : `Fetch subtitles from OpenSubtitles on your local network. Translation is disabled until ContextWeave is configured.`;
  return {
    id: config.addonId,
    version: "0.1.0",
    name: config.addonName,
    description: modeDescription,
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

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function subtitleListLabel(subtitle) {
  const code = normalizeLanguageCode(subtitle?.languageCode || subtitle?.language || "");
  if (code) return code;

  const fallback = String(subtitle?.language || "").trim();
  if (fallback && !["und", "unknown", "undefined"].includes(fallback.toLowerCase())) return fallback;
  return "subtitle";
}

function translatedSubtitleLang(targetLanguage) {
  return normalizeLanguageCode(targetLanguage) || String(targetLanguage || "subtitle");
}

function subtitleUrlFormat(subtitle) {
  return normalizeSubtitleFormat(subtitle?.format || "srt");
}

function stripSubtitleFormatSuffix(value) {
  return String(value || "").replace(/\.(srt|vtt|ass|ssa)$/i, "");
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
