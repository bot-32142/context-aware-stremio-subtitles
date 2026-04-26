const { normalizeLanguageCode } = require("./languages");
const { extractSubtitleFromArchive, isArchive } = require("./archiveExtractor");
const { detectAndConvertEncoding } = require("./encodingDetector");
const { analyzeResponseContent } = require("./responseAnalyzer");
const { detectSubtitleFormat, inferFormatFromName, normalizeSubtitleFormat } = require("./subtitleFormat");

const BASE_URL = "https://opensubtitles-v3.strem.io/subtitles";

function encodeFileId(url) {
  return `v3_${Buffer.from(String(url), "utf8").toString("base64url")}`;
}

function decodeFileId(fileId) {
  const raw = String(fileId || "");
  if (!raw.startsWith("v3_")) throw new Error("Unsupported OpenSubtitles V3 file id.");
  return Buffer.from(raw.slice(3), "base64url").toString("utf8");
}

class OpenSubtitlesV3Provider {
  constructor({ timeoutMs = 12000, fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
    this.name = "opensubtitles-v3";
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  canDownload(fileId) {
    return String(fileId || "").startsWith("v3_");
  }

  async search(mediaInfo, languages = []) {
    if (!mediaInfo?.imdbId) return [];
    const url = `${BASE_URL}/${buildSearchPath(mediaInfo)}`;
    const response = await fetchWithTimeout(this.fetch, url, {
      headers: { Accept: "application/json" },
      timeoutMs: this.timeoutMs
    });
    if (!response.ok) {
      throw new Error(`OpenSubtitles V3 search failed with HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const subtitles = Array.isArray(payload?.subtitles) ? payload.subtitles : [];
    const requested = new Set(languages.map(normalizeLanguageCode).filter(Boolean));

    return subtitles
      .map(subtitle => this._mapSubtitle(subtitle))
      .filter(subtitle => subtitle && (!requested.size || requested.has(subtitle.languageCode)));
  }

  async download(fileId, options = {}) {
    const url = decodeFileId(fileId);
    const response = await fetchWithTimeout(this.fetch, url, {
      headers: { Accept: "*/*" },
      timeoutMs: this.timeoutMs
    });
    if (!response.ok) {
      throw new Error(`OpenSubtitles V3 download failed with HTTP ${response.status}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const extracted = isArchive(bytes)
      ? await extractSubtitleFromArchive(bytes, {
          providerName: "OpenSubtitles V3",
          sourceName: url,
          languageHint: options.languageHint
        })
      : decodePayload(bytes, url, options);
    const content = extracted.content;
    if (!content.trim()) throw new Error("Downloaded subtitle is empty.");
    return {
      content,
      format: normalizeSubtitleFormat(extracted.format || detectSubtitleFormat(content, inferFormatFromName(extracted.name || url))),
      sourceUrl: url
    };
  }

  _mapSubtitle(subtitle) {
    const downloadUrl = String(subtitle?.url || "").trim();
    if (!downloadUrl) return null;
    const languageCode = normalizeLanguageCode(subtitle.lang || subtitle.language || "");
    if (!languageCode) return null;
    const urlName = inferNameFromUrl(downloadUrl);
    const name = String(subtitle.name || subtitle.filename || urlName || `OpenSubtitles #${subtitle.id || ""}`).trim();
    return {
      id: encodeFileId(downloadUrl),
      fileId: encodeFileId(downloadUrl),
      languageCode,
      language: subtitle.lang || languageCode,
      name,
      provider: "opensubtitles-v3",
      format: inferFormatFromName(downloadUrl),
      downloadLink: downloadUrl
    };
  }
}

function buildSearchPath(mediaInfo) {
  const imdbId = mediaInfo.imdbId.startsWith("tt") ? mediaInfo.imdbId : `tt${mediaInfo.imdbId}`;
  if (mediaInfo.isEpisode && mediaInfo.season && mediaInfo.episode) {
    return `series/${imdbId}:${mediaInfo.season}:${mediaInfo.episode}.json`;
  }
  return `movie/${imdbId}.json`;
}

async function fetchWithTimeout(fetchImpl, url, { timeoutMs, ...options }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function inferNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(segment).replace(/\.[^.]+$/, "");
  } catch (_error) {
    return "";
  }
}

function decodePayload(bytes, sourceName, options = {}) {
  const analysis = analyzeResponseContent(bytes);
  if (analysis.type !== "subtitle" && analysis.type !== "unknown") {
    throw new Error(`OpenSubtitles V3 returned ${analysis.type}: ${analysis.hint}`);
  }
  const content = detectAndConvertEncoding(bytes, "OpenSubtitles V3", options.languageHint || null);
  return {
    content,
    format: detectSubtitleFormat(content, inferFormatFromName(sourceName)),
    name: sourceName
  };
}

module.exports = {
  OpenSubtitlesV3Provider,
  buildSearchPath,
  decodeFileId,
  encodeFileId
};
