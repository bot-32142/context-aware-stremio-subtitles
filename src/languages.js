const ISO1_TO_ISO3 = {
  ar: "ara",
  bn: "ben",
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
  gu: "guj",
  kn: "kan",
  ko: "kor",
  lt: "lit",
  lv: "lav",
  ml: "mal",
  mr: "mar",
  ms: "may",
  nl: "dut",
  no: "nor",
  pa: "pan",
  pl: "pol",
  pt: "por",
  ro: "rum",
  ru: "rus",
  sk: "slo",
  sl: "slv",
  sv: "swe",
  sw: "swa",
  ta: "tam",
  te: "tel",
  tl: "fil",
  th: "tha",
  tr: "tur",
  uk: "ukr",
  ur: "urd",
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
Object.assign(ALIASES, {
  msa: "may",
  tgl: "fil"
});

const LANGUAGE_NAMES = {
  ara: "Arabic",
  ben: "Bengali",
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
  guj: "Gujarati",
  heb: "Hebrew",
  hin: "Hindi",
  hrv: "Croatian",
  hun: "Hungarian",
  ind: "Indonesian",
  ita: "Italian",
  jpn: "Japanese",
  kan: "Kannada",
  kor: "Korean",
  lav: "Latvian",
  lit: "Lithuanian",
  mal: "Malayalam",
  mar: "Marathi",
  may: "Malay",
  nor: "Norwegian",
  pan: "Punjabi",
  per: "Persian",
  pol: "Polish",
  por: "Portuguese",
  rum: "Romanian",
  rus: "Russian",
  slo: "Slovak",
  slv: "Slovenian",
  spa: "Spanish",
  swa: "Swahili",
  swe: "Swedish",
  tam: "Tamil",
  tel: "Telugu",
  fil: "Filipino",
  tha: "Thai",
  tur: "Turkish",
  ukr: "Ukrainian",
  urd: "Urdu",
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

// ContextWeave v2.8+ validates targets against its native-script language
// presets. Keep this conversion separate from Stremio/provider ISO-639 codes.
const CONTEXTWEAVE_TARGETS = {
  ara: "العربية",
  ben: "বাংলা",
  bul: "Български",
  chi: "中文（简体）",
  cze: "Čeština",
  dan: "Dansk",
  dut: "Nederlands",
  ell: "Ελληνικά",
  eng: "English",
  est: "Eesti",
  fin: "Suomi",
  fre: "Français",
  ger: "Deutsch",
  guj: "ગુજરાતી",
  heb: "עברית",
  hin: "हिन्दी",
  hrv: "Hrvatski",
  hun: "Magyar",
  ind: "Bahasa Indonesia",
  ita: "Italiano",
  jpn: "日本語",
  kan: "ಕನ್ನಡ",
  kor: "한국어",
  lav: "Latviešu",
  lit: "Lietuvių",
  mal: "മലയാളം",
  mar: "मराठी",
  may: "Bahasa Melayu",
  nor: "Norsk",
  pan: "ਪੰਜਾਬੀ",
  per: "فارسی",
  pol: "Polski",
  por: "Português",
  rum: "Română",
  rus: "Русский",
  slo: "Slovenčina",
  slv: "Slovenščina",
  spa: "Español",
  swa: "Kiswahili",
  swe: "Svenska",
  tam: "தமிழ்",
  tel: "తెలుగు",
  fil: "Filipino",
  tha: "ไทย",
  tur: "Türkçe",
  ukr: "Українська",
  urd: "اردو",
  vie: "Tiếng Việt"
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

function getContextWeaveTargetLanguage(value) {
  const raw = String(value || "").trim();
  const directTarget = Object.values(CONTEXTWEAVE_TARGETS).find(
    target => target.toLocaleLowerCase() === raw.toLocaleLowerCase()
  );
  if (directTarget) return directTarget;
  if (raw === "中文（繁體）" || raw === "繁体中文") return "中文（繁體）";
  if (raw === "中文（简体）" || raw === "简体中文") return "中文（简体）";

  const label = getLanguageLabel(value);
  if (label === "Traditional Chinese") return "中文（繁體）";
  if (label === "Simplified Chinese" || label === "Chinese") return "中文（简体）";

  const normalized = normalizeLanguageCode(value);
  const target = CONTEXTWEAVE_TARGETS[normalized];
  if (!target) {
    throw new Error(`Target language ${JSON.stringify(String(value || ""))} is not supported by ContextWeave.`);
  }
  return target;
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
  getContextWeaveTargetLanguage,
  getLanguageLabel,
  getLanguageName,
  normalizeLanguageCode,
  parseLanguageList,
  toISO6391
};
