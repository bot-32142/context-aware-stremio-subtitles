const os = require("node:os");
const path = require("node:path");
const { parseLanguageList } = require("./languages");

function expandHome(value) {
  const text = String(value || "");
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function loadConfig(env = process.env) {
  const dataDir = path.resolve(expandHome(env.DATA_DIR || path.join(process.cwd(), "data")));
  return {
    addonId: env.ADDON_ID || "local.context-aware-stremio-subtitles",
    addonName: env.ADDON_NAME || "Context-Aware Stremio Subtitles",
    baseUrl: env.BASE_URL || "",
    port: Number.parseInt(env.PORT || "7001", 10),
    dataDir,
    tmpDir: path.resolve(expandHome(env.TMP_DIR || path.join(dataDir, "tmp"))),
    translationDir: path.resolve(expandHome(env.TRANSLATION_DIR || path.join(dataDir, "translations"))),
    catLibraryRoot: path.resolve(expandHome(env.CAT_LIBRARY_ROOT || path.join(dataDir, "cat-library"))),
    catConfig: env.CAT_CONFIG ? path.resolve(expandHome(env.CAT_CONFIG)) : "",
    catCliCommand: env.CAT_CLI_CMD || "cat-cli",
    sourceLanguages: parseLanguageList(env.SOURCE_LANGUAGES || "eng", ["eng"]),
    targetLanguages: parseLanguageList(env.TARGET_LANGUAGES || "chi", ["chi"]),
    maxSubtitlesPerLanguage: Number.parseInt(env.MAX_SUBTITLES_PER_LANGUAGE || "5", 10),
    providerTimeoutMs: Number.parseInt(env.PROVIDER_TIMEOUT_MS || "12000", 10)
  };
}

function resolveBaseUrl(req, configuredBaseUrl) {
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

module.exports = {
  expandHome,
  loadConfig,
  resolveBaseUrl
};
