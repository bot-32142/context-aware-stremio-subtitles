const JSZip = require("jszip");
const { normalizeLanguageCode } = require("./languages");
const { detectSubtitleFormat, inferFormatFromName } = require("./subtitleFormat");

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
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
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

  async download(fileId) {
    const url = decodeFileId(fileId);
    const response = await fetchWithTimeout(this.fetch, url, {
      headers: { Accept: "*/*" },
      timeoutMs: this.timeoutMs
    });
    if (!response.ok) {
      throw new Error(`OpenSubtitles V3 download failed with HTTP ${response.status}.`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const extracted = await extractSubtitlePayload(bytes, url);
    const content = stripUtf8Bom(extracted.bytes.toString("utf8"));
    if (!content.trim()) throw new Error("Downloaded subtitle is empty.");
    return {
      content,
      format: detectSubtitleFormat(content, inferFormatFromName(extracted.name || url)),
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

function stripUtf8Bom(value) {
  return String(value || "").replace(/^\uFEFF/, "");
}

async function extractSubtitlePayload(bytes, sourceName) {
  if (isZip(bytes)) {
    return extractSubtitleFromZip(bytes);
  }
  if (isKnownArchive(bytes)) {
    throw new Error("Downloaded subtitle is an archive format this addon cannot extract yet.");
  }
  return { bytes, name: sourceName };
}

async function extractSubtitleFromZip(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const candidates = [];
  zip.forEach((name, file) => {
    if (file.dir || name.startsWith("__MACOSX/")) return;
    const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
    const format = match ? match[1] : "";
    if (!["srt", "vtt", "ass", "ssa"].includes(format)) return;
    candidates.push({ name, file, format });
  });
  candidates.sort((a, b) => archiveFormatPriority(a.format) - archiveFormatPriority(b.format) || a.name.localeCompare(b.name));
  const selected = candidates[0];
  if (!selected) throw new Error("Downloaded archive did not contain a supported subtitle file.");
  return {
    bytes: await selected.file.async("nodebuffer"),
    name: selected.name
  };
}

function archiveFormatPriority(format) {
  return { srt: 0, vtt: 1, ass: 2, ssa: 3 }[format] ?? 99;
}

function isZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function isKnownArchive(bytes) {
  if (isZip(bytes)) return true;
  const signature = bytes.subarray(0, 8).toString("latin1");
  return signature.startsWith("Rar!\x1A\x07") || signature.startsWith("7z\xBC\xAF\x27\x1C") || (bytes[0] === 0x1f && bytes[1] === 0x8b);
}

module.exports = {
  OpenSubtitlesV3Provider,
  buildSearchPath,
  decodeFileId,
  encodeFileId
};
