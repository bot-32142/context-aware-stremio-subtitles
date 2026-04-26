const chardet = require("chardet");
const iconv = require("iconv-lite");
const log = require("./logger");

const LANGUAGE_ENCODING_HINTS = {
  ara: ["windows-1256", "iso-8859-6"],
  ar: ["windows-1256", "iso-8859-6"],
  heb: ["windows-1255", "iso-8859-8"],
  he: ["windows-1255", "iso-8859-8"],
  per: ["windows-1256"],
  fas: ["windows-1256"],
  fa: ["windows-1256"],
  rus: ["windows-1251", "koi8-r"],
  ru: ["windows-1251", "koi8-r"],
  ukr: ["windows-1251", "koi8-u"],
  uk: ["windows-1251", "koi8-u"],
  gre: ["windows-1253", "iso-8859-7"],
  ell: ["windows-1253", "iso-8859-7"],
  el: ["windows-1253", "iso-8859-7"],
  tur: ["windows-1254", "iso-8859-9"],
  tr: ["windows-1254", "iso-8859-9"],
  pol: ["windows-1250", "iso-8859-2"],
  cze: ["windows-1250", "iso-8859-2"],
  ces: ["windows-1250", "iso-8859-2"],
  hun: ["windows-1250", "iso-8859-2"],
  rum: ["windows-1250", "iso-8859-2"],
  ron: ["windows-1250", "iso-8859-2"],
  tha: ["windows-874", "tis-620"],
  th: ["windows-874", "tis-620"],
  vie: ["windows-1258"],
  vi: ["windows-1258"],
  chi: ["gb18030", "gbk", "big5"],
  zho: ["gb18030", "gbk", "big5"],
  zh: ["gb18030", "gbk", "big5"],
  zhs: ["gb18030", "gbk"],
  zht: ["big5"],
  jpn: ["shift_jis", "euc-jp"],
  ja: ["shift_jis", "euc-jp"],
  kor: ["euc-kr"],
  ko: ["euc-kr"]
};

const FALLBACK_ENCODINGS = [
  "utf8",
  "windows-1252",
  "iso-8859-1",
  "windows-1250",
  "windows-1251",
  "windows-1256",
  "gb18030",
  "big5",
  "shift_jis",
  "euc-kr"
];

function detectAndConvertEncoding(content, source = "subtitle", languageHint = null) {
  if (typeof content === "string") return stripUtf8Bom(content);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || "");
  if (!buffer.length) return "";

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return iconv.decode(buffer.subarray(2), "utf-16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return iconv.decode(buffer.subarray(2), "utf-16be");
  }

  const utf8 = buffer.toString("utf8");
  if (looksHealthy(utf8)) return stripUtf8Bom(utf8);

  for (const encoding of encodingsForHint(languageHint)) {
    const decoded = decodeIfSupported(buffer, encoding);
    if (decoded && looksHealthy(decoded, languageHint)) {
      log.debug(() => `[${source}] decoded subtitle with language hint ${encoding}`);
      return stripUtf8Bom(decoded);
    }
  }

  const detected = chardet.detect(buffer.subarray(0, Math.min(buffer.length, 512 * 1024)));
  if (detected) {
    const decoded = decodeIfSupported(buffer, normalizeEncodingName(detected));
    if (decoded && looksHealthy(decoded, languageHint)) {
      log.debug(() => `[${source}] decoded subtitle with chardet ${detected}`);
      return stripUtf8Bom(decoded);
    }
  }

  for (const encoding of FALLBACK_ENCODINGS) {
    const decoded = decodeIfSupported(buffer, encoding);
    if (decoded && looksHealthy(decoded, languageHint)) return stripUtf8Bom(decoded);
  }

  return stripUtf8Bom(utf8);
}

function encodingsForHint(languageHint) {
  const normalized = String(languageHint || "").trim().toLowerCase();
  if (!normalized) return [];
  const base = normalized.split(/[-_]/)[0];
  return [...new Set([...(LANGUAGE_ENCODING_HINTS[normalized] || []), ...(LANGUAGE_ENCODING_HINTS[base] || [])])];
}

function decodeIfSupported(buffer, encoding) {
  if (!encoding || !iconv.encodingExists(encoding)) return "";
  try {
    return iconv.decode(buffer, encoding);
  } catch (_error) {
    return "";
  }
}

function normalizeEncodingName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^iso[-_ ]?8859[-_ ]?/, "iso-8859-")
    .replace(/^windows[-_ ]?/, "windows-");
}

function looksHealthy(text, languageHint = null) {
  if (!text) return false;
  const replacementRatio = (text.match(/\uFFFD/g) || []).length / Math.max(text.length, 1);
  if (replacementRatio > 0.01) return false;
  if (/\x00{2,}/.test(text)) return false;

  const hint = String(languageHint || "").toLowerCase().split(/[-_]/)[0];
  const scriptChecks = {
    ar: /[\u0600-\u06FF]/,
    fa: /[\u0600-\u06FF]/,
    he: /[\u0590-\u05FF]/,
    ru: /[\u0400-\u04FF]/,
    uk: /[\u0400-\u04FF]/,
    el: /[\u0370-\u03FF]/,
    th: /[\u0E00-\u0E7F]/
  };
  const check = scriptChecks[hint];
  if (!check) return true;
  const lettersOnly = text.replace(/[ -~\s\d:,.!?'"()[\]{}<>/\\|-]/g, "");
  return lettersOnly.length < 6 || check.test(lettersOnly);
}

function stripUtf8Bom(value) {
  return String(value || "").replace(/^\uFEFF/, "");
}

module.exports = {
  detectAndConvertEncoding,
  encodingsForHint,
  looksHealthy
};
