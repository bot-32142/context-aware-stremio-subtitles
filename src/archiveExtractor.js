const path = require("node:path");
const zlib = require("node:zlib");
const JSZip = require("jszip");
const { detectAndConvertEncoding } = require("./encodingDetector");
const { detectSubtitleFormat, inferFormatFromName, normalizeSubtitleFormat } = require("./subtitleFormat");

const SUPPORTED_EXTENSIONS = new Set(["srt", "vtt", "ass", "ssa", "sub", "txt"]);

function detectArchiveType(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip";
  if (bytes.length >= 6 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21 && bytes[4] === 0x1a && bytes[5] === 0x07) return "rar";
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return "gzip";
  if (bytes.length >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf && bytes[4] === 0x27 && bytes[5] === 0x1c) return "7z";
  if (bytes.length >= 6 && bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a && bytes[3] === 0x58 && bytes[4] === 0x5a && bytes[5] === 0x00) return "xz";
  if (bytes.length >= 3 && bytes[0] === 0x42 && bytes[1] === 0x5a && bytes[2] === 0x68) return "bz2";
  if (bytes.length >= 263 && bytes.subarray(257, 262).toString("ascii") === "ustar") return "tar";
  return null;
}

function isArchive(buffer) {
  return detectArchiveType(buffer) !== null;
}

async function extractSubtitleFromArchive(buffer, options = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  const maxBytes = options.maxBytes || 25 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new Error(`Subtitle archive is too large (${bytes.length} bytes, limit ${maxBytes}).`);
  }

  const archiveType = detectArchiveType(bytes);
  if (!archiveType) return decodeSubtitlePayload(bytes, options.sourceName || "subtitle", options);

  let files;
  if (archiveType === "zip") files = await extractZip(bytes);
  else if (archiveType === "rar") {
    try {
      files = await extractRar(bytes);
    } catch (error) {
      throw new Error(`Downloaded subtitle archive format RAR could not be extracted: ${error.message}`);
    }
  }
  else if (archiveType === "gzip") files = new Map([[stripCompressionExtension(options.sourceName || "subtitle.srt.gz"), await gunzip(bytes)]]);
  else if (archiveType === "tar") files = await extractTar(bytes);
  else throw new Error(`Downloaded subtitle archive type ${archiveType} is not supported yet.`);

  const selected = selectSubtitleFile(files, options);
  if (!selected) throw new Error("Downloaded archive did not contain a supported subtitle file.");
  return decodeSubtitlePayload(selected.bytes, selected.name, options);
}

async function extractZip(buffer) {
  const zip = await JSZip.loadAsync(buffer, { base64: false });
  const files = new Map();
  const reads = [];
  zip.forEach((name, file) => {
    if (file.dir || isUnsafeArchivePath(name)) return;
    reads.push(file.async("nodebuffer").then(bytes => files.set(name, bytes)));
  });
  await Promise.all(reads);
  return files;
}

async function extractRar(buffer) {
  const { createExtractorFromData } = require("node-unrar-js");
  const extractor = await createExtractorFromData({ data: buffer });
  const extracted = extractor.extract();
  const files = new Map();
  for (const file of extracted.files || []) {
    if (!file.extraction) continue;
    const name = file.fileHeader?.name || "";
    if (!name || isUnsafeArchivePath(name)) continue;
    files.set(name, Buffer.from(file.extraction));
  }
  return files;
}

function extractTar(buffer) {
  const tar = require("tar-stream");
  return new Promise((resolve, reject) => {
    const extract = tar.extract();
    const files = new Map();
    extract.on("entry", (header, stream, next) => {
      const chunks = [];
      stream.on("data", chunk => chunks.push(chunk));
      stream.on("end", () => {
        if (header.type === "file" && !isUnsafeArchivePath(header.name)) {
          files.set(header.name, Buffer.concat(chunks));
        }
        next();
      });
      stream.resume();
    });
    extract.on("finish", () => resolve(files));
    extract.on("error", reject);
    extract.end(buffer);
  });
}

function gunzip(buffer) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(buffer, (error, output) => (error ? reject(error) : resolve(output)));
  });
}

function selectSubtitleFile(files, options = {}) {
  const candidates = [];
  for (const [name, bytes] of files.entries()) {
    const ext = path.extname(name).slice(1).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    candidates.push({
      name,
      bytes,
      ext,
      score: scoreArchiveCandidate(name, ext, options)
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return candidates[0] || null;
}

function scoreArchiveCandidate(name, ext, options = {}) {
  let score = ({ srt: 80, vtt: 70, ass: 60, ssa: 55, sub: 35, txt: 10 }[ext] || 0);
  const lower = name.toLowerCase();
  if (options.season && options.episode) {
    const season = String(options.season).padStart(2, "0");
    const episode = String(options.episode).padStart(2, "0");
    if (new RegExp(`s0*${Number(options.season)}e0*${Number(options.episode)}\\b`, "i").test(lower)) score += 200;
    if (lower.includes(`s${season}e${episode}`)) score += 220;
    if (new RegExp(`\\b${Number(options.season)}x0*${Number(options.episode)}\\b`, "i").test(lower)) score += 180;
  }
  if (/forced|foreign/.test(lower)) score -= 40;
  if (/sdh|hearing.?impaired|hi\./.test(lower)) score -= 10;
  return score;
}

function decodeSubtitlePayload(bytes, name, options = {}) {
  const content = detectAndConvertEncoding(bytes, options.providerName || "subtitle", options.languageHint || null);
  const format = normalizeSubtitleFormat(detectSubtitleFormat(content, inferFormatFromName(name)));
  if (!content.trim()) throw new Error("Downloaded subtitle is empty.");
  return { content, format, name };
}

function isUnsafeArchivePath(name) {
  const normalized = String(name || "").replace(/\\/g, "/");
  return !normalized || normalized.startsWith("/") || normalized.startsWith("__MACOSX/") || /(^|\/)\.\.(\/|$)/.test(normalized);
}

function stripCompressionExtension(name) {
  return String(name || "subtitle").replace(/\.(gz|gzip)$/i, "");
}

module.exports = {
  detectArchiveType,
  extractSubtitleFromArchive,
  isArchive,
  selectSubtitleFile
};
