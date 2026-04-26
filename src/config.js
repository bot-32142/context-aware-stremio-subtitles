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
  const catConfig = env.CAT_CONFIG ? path.resolve(expandHome(env.CAT_CONFIG)) : "";
  return {
    addonId: env.ADDON_ID || "local.context-aware-stremio-subtitles",
    addonName: env.ADDON_NAME || "Context-Aware Stremio Subtitles",
    baseUrl: env.BASE_URL || "",
    host: env.HOST || "0.0.0.0",
    port: Number.parseInt(env.PORT || "7001", 10),
    dataDir,
    tmpDir: path.resolve(expandHome(env.TMP_DIR || path.join(dataDir, "tmp"))),
    translationDir: path.resolve(expandHome(env.TRANSLATION_DIR || path.join(dataDir, "translations"))),
    catLibraryRoot: path.resolve(expandHome(env.CAT_LIBRARY_ROOT || path.join(dataDir, "cat-library"))),
    catConfig,
    catCliCommand: env.CAT_CLI_CMD || "cat-cli",
    catNoPolish: parseBooleanEnv(env.CAT_NO_POLISH, false),
    translationEnabled: parseBooleanEnv(env.ENABLE_TRANSLATION, Boolean(catConfig)),
    sourceLanguages: parseLanguageList(env.SOURCE_LANGUAGES || "eng", ["eng"]),
    targetLanguages: parseLanguageList(env.TARGET_LANGUAGES || "chi", ["chi"]),
    maxSubtitlesPerLanguage: Number.parseInt(env.MAX_SUBTITLES_PER_LANGUAGE || "5", 10),
    providerTimeoutMs: Number.parseInt(env.PROVIDER_TIMEOUT_MS || "12000", 10),
    idResolverTimeoutMs: Number.parseInt(env.ID_RESOLVER_TIMEOUT_MS || "8000", 10),
    subtitleProviders: parseProviderList(env.SUBTITLE_PROVIDERS || "opensubtitles-v3,scs"),
    excludeHearingImpairedSubtitles: parseBooleanEnv(env.EXCLUDE_HEARING_IMPAIRED_SUBTITLES, false),
    deduplicateSubtitles: parseBooleanEnv(env.DEDUPLICATE_SUBTITLES, true),
    subdlApiKey: env.SUBDL_API_KEY || "",
    subsourceApiKey: env.SUBSOURCE_API_KEY || "",
    subsRoApiKey: env.SUBSRO_API_KEY || "",
    wyzieApiKey: env.WYZIE_API_KEY || "",
    scsManifestToken: env.SCS_MANIFEST_TOKEN || ""
  };
}

function parseBooleanEnv(value, defaultValue) {
  if (value === undefined || value === null || value === "") return defaultValue;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function parseProviderList(value) {
  const aliases = {
    opensubtitles: "opensubtitles-v3",
    opensubtitlesv3: "opensubtitles-v3",
    "opensubtitles_v3": "opensubtitles-v3",
    stremiocommunitysubtitles: "scs",
    community: "scs",
    "subs.ro": "subsro",
    wyziesubs: "wyzie"
  };
  const allowed = new Set(["opensubtitles-v3", "scs", "subdl", "subsource", "subsro", "wyzie"]);
  const providers = String(value || "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .map(item => aliases[item] || item)
    .filter(item => allowed.has(item));
  return [...new Set(providers.length ? providers : ["opensubtitles-v3"])];
}

function resolveBaseUrl(req, configuredBaseUrl) {
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

function advertisedBaseUrls(config, networkInterfaces = os.networkInterfaces()) {
  if (config.baseUrl) return [config.baseUrl.replace(/\/+$/, "")];

  const host = String(config.host || "0.0.0.0");
  if (host === "0.0.0.0" || host === "::") {
    const lanAddresses = lanIPv4Addresses(networkInterfaces);
    if (!lanAddresses.length) return [`http://127.0.0.1:${config.port}`];
    return lanAddresses.map(address => `http://${address}:${config.port}`);
  }

  return [`http://${formatHostForUrl(host)}:${config.port}`];
}

function lanIPv4Addresses(networkInterfaces) {
  const addresses = [];
  const seen = new Set();
  for (const entries of Object.values(networkInterfaces || {})) {
    for (const entry of entries || []) {
      if (entry.internal || entry.family !== "IPv4" || !isPrivateIPv4(entry.address)) continue;
      if (seen.has(entry.address)) continue;
      seen.add(entry.address);
      addresses.push(entry.address);
    }
  }
  return addresses;
}

function isPrivateIPv4(address) {
  const parts = String(address || "")
    .split(".")
    .map(part => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function formatHostForUrl(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

module.exports = {
  advertisedBaseUrls,
  expandHome,
  formatHostForUrl,
  isPrivateIPv4,
  lanIPv4Addresses,
  loadConfig,
  parseProviderList,
  resolveBaseUrl
};
