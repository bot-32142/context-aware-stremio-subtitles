const ISO1_TO_ISO3 = {
  ar: "ara",
  bg: "bul",
  ca: "cat",
  cs: "cze",
  da: "dan",
  de: "ger",
  el: "ell",
  en: "eng",
  es: "spa",
  et: "est",
  fa: "per",
  fi: "fin",
  fr: "fre",
  he: "heb",
  hi: "hin",
  hr: "hrv",
  hu: "hun",
  id: "ind",
  it: "ita",
  ja: "jpn",
  ko: "kor",
  nl: "dut",
  no: "nor",
  pl: "pol",
  pt: "por",
  ro: "rum",
  ru: "rus",
  sk: "slo",
  sv: "swe",
  th: "tha",
  tr: "tur",
  uk: "ukr",
  vi: "vie",
  zh: "chi"
};

const ISO3_TO_ISO1 = Object.fromEntries(Object.entries(ISO1_TO_ISO3).map(([iso1, iso3]) => [iso3, iso1]));
Object.assign(ISO3_TO_ISO1, {
  zho: "zh",
  zhs: "zh",
  zht: "zh",
  fra: "fr",
  deu: "de",
  nld: "nl",
  ces: "cs",
  ron: "ro",
  slk: "sk",
  fas: "fa",
  pob: "pt-br",
  spn: "es"
});

const ALIASES = {
  zho: "chi",
  cmn: "chi",
  zhs: "chi",
  zht: "chi",
  ze: "chi",
  spa: "spa",
  spn: "spa",
  jpn: "jpn",
  ja: "jpn",
  chi: "chi",
  chs: "chi",
  cht: "chi",
  fre: "fre",
  fra: "fre",
  ger: "ger",
  deu: "ger",
  dut: "dut",
  nld: "dut",
  cze: "cze",
  ces: "cze",
  rum: "rum",
  ron: "rum",
  slo: "slo",
  slk: "slo",
  per: "per",
  fas: "per"
};

const LANGUAGE_NAMES = {
  ara: "Arabic",
  bul: "Bulgarian",
  cat: "Catalan",
  chi: "Chinese",
  cze: "Czech",
  dan: "Danish",
  dut: "Dutch",
  ell: "Greek",
  eng: "English",
  est: "Estonian",
  fin: "Finnish",
  fre: "French",
  ger: "German",
  heb: "Hebrew",
  hin: "Hindi",
  hrv: "Croatian",
  hun: "Hungarian",
  ind: "Indonesian",
  ita: "Italian",
  jpn: "Japanese",
  kor: "Korean",
  nor: "Norwegian",
  per: "Persian",
  pol: "Polish",
  por: "Portuguese",
  rum: "Romanian",
  rus: "Russian",
  slo: "Slovak",
  spa: "Spanish",
  swe: "Swedish",
  tha: "Thai",
  tur: "Turkish",
  ukr: "Ukrainian",
  vie: "Vietnamese"
};

const LANGUAGE_DISPLAY_NAMES = {
  "brazilian portuguese": "Brazilian Portuguese",
  pob: "Brazilian Portuguese",
  "portuguese brazil": "Brazilian Portuguese",
  "portuguese br": "Brazilian Portuguese",
  "pt br": "Brazilian Portuguese",
  "simplified chinese": "Simplified Chinese",
  chs: "Simplified Chinese",
  "traditional chinese": "Traditional Chinese",
  cht: "Traditional Chinese",
  zhs: "Simplified Chinese",
  zht: "Traditional Chinese",
  "zh hans": "Simplified Chinese",
  "zh hant": "Traditional Chinese"
};

const LANGUAGE_NAME_ALIASES = Object.fromEntries(
  Object.entries(LANGUAGE_NAMES).map(([code, name]) => [name.toLowerCase(), code])
);
Object.assign(LANGUAGE_NAME_ALIASES, {
  "brazilian portuguese": "por",
  pob: "por",
  "portuguese brazil": "por",
  "portuguese br": "por",
  "pt br": "por",
  "simplified chinese": "chi",
  "traditional chinese": "chi",
  "zh hans": "chi",
  "zh hant": "chi"
});

function normalizeLanguageCode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const normalizedName = normalizeLanguageName(raw);
  if (["und", "unknown", "undefined", "undetermined", "not specified"].includes(raw)) return "";
  if (["unknown", "undefined", "undetermined", "not specified"].includes(normalizedName)) return "";
  const bcp47Base = raw.split("-")[0];
  if (ALIASES[raw]) return ALIASES[raw];
  if (LANGUAGE_NAME_ALIASES[normalizedName]) return LANGUAGE_NAME_ALIASES[normalizedName];
  if (ISO1_TO_ISO3[raw]) return ISO1_TO_ISO3[raw];
  if (ISO1_TO_ISO3[bcp47Base]) return ISO1_TO_ISO3[bcp47Base];
  if (/^[a-z]{3}$/.test(raw)) return ALIASES[raw] || raw;
  return raw;
}

function parseLanguageList(value, fallback) {
  const items = String(value || "")
    .split(",")
    .map(normalizeLanguageCode)
    .filter(Boolean);
  return [...new Set(items.length ? items : fallback)];
}

function getLanguageName(code) {
  const normalized = normalizeLanguageCode(code);
  return LANGUAGE_NAMES[normalized] || normalized.toUpperCase();
}

function getLanguageLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return LANGUAGE_DISPLAY_NAMES[normalizeLanguageName(raw)] || getLanguageName(raw);
}

function toISO6391(code) {
  const normalized = normalizeLanguageCode(code);
  return ISO3_TO_ISO1[normalized] || (/^[a-z]{2}$/.test(String(code || "").toLowerCase()) ? String(code).toLowerCase() : "");
}

function normalizeLanguageName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[()[\]_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  getLanguageLabel,
  getLanguageName,
  normalizeLanguageCode,
  parseLanguageList,
  toISO6391
};
