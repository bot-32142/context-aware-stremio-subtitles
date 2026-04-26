const axios = require("axios");
const { IdResolver } = require("./idResolver");
const { normalizeLanguageCode, toISO6391 } = require("./languages");
const { detectAndConvertEncoding } = require("./encodingDetector");
const { extractSubtitleFromArchive, isArchive } = require("./archiveExtractor");
const { analyzeResponseContent } = require("./responseAnalyzer");
const { detectSubtitleFormat, inferFormatFromName, normalizeSubtitleFormat } = require("./subtitleFormat");
const { OpenSubtitlesV3Provider } = require("./openSubtitlesV3");
const log = require("./logger");

const SCS_BASE_URL = "https://stremio-community-subtitles.top";
const SCS_FALLBACK_TOKEN = "yNejf3661w9R1Agdh7ARxE8MzhSVpL2TzMn5jueHFzw";
const SUBSOURCE_BASE_URL = "https://api.subsource.net/api/v1";
const SUBSRO_BASE_URL = "https://subs.ro/api/v1.0";
const WYZIE_BASE_URL = "https://sub.wyzie.ru";
const USER_AGENT = "context-aware-stremio-subtitles/0.1";

class ProviderManager {
  constructor({ config, fetchImpl = globalThis.fetch, providers = null } = {}) {
    this.config = config;
    this.idResolver = new IdResolver({ dataDir: config.dataDir, fetchImpl, timeoutMs: config.idResolverTimeoutMs });
    this.providers = providers || buildProviders(config, fetchImpl);
  }

  async search(mediaInfo, languages = [], extras = {}) {
    const resolvedInfo = await this.idResolver.resolve(mediaInfo);
    const tasks = this.providers.map(provider =>
      provider
        .search(resolvedInfo, languages, extras)
        .then(results => ({ provider: provider.name, results }))
        .catch(error => {
          log.warn(() => `[Provider] ${provider.name} search failed: ${error.message}`);
          return { provider: provider.name, results: [] };
        })
    );
    const settled = await Promise.all(tasks);
    return settled.flatMap(item => item.results || []);
  }

  async download(fileId, options = {}) {
    const provider = this.providers.find(candidate => candidate.canDownload(fileId));
    if (!provider) throw new Error(`No subtitle provider can download ${fileId}.`);
    return provider.download(fileId, options);
  }
}

function buildProviders(config, fetchImpl) {
  const enabled = new Set(config.subtitleProviders);
  const providers = [];
  if (enabled.has("opensubtitles-v3")) providers.push(new OpenSubtitlesV3Provider({ timeoutMs: config.providerTimeoutMs, fetchImpl }));
  if (enabled.has("scs")) providers.push(new StremioCommunityProvider({ timeoutMs: config.providerTimeoutMs, token: config.scsManifestToken }));
  if (enabled.has("subdl")) providers.push(new SubDLProvider({ timeoutMs: config.providerTimeoutMs, apiKey: config.subdlApiKey }));
  if (enabled.has("subsource")) providers.push(new SubSourceProvider({ timeoutMs: config.providerTimeoutMs, apiKey: config.subsourceApiKey }));
  if (enabled.has("subsro")) providers.push(new SubsRoProvider({ timeoutMs: config.providerTimeoutMs, apiKey: config.subsRoApiKey }));
  if (enabled.has("wyzie")) providers.push(new WyzieProvider({ timeoutMs: config.providerTimeoutMs, apiKey: config.wyzieApiKey }));
  return providers;
}

class SubDLProvider {
  constructor({ apiKey = "", timeoutMs = 12000 } = {}) {
    this.name = "subdl";
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.client = axios.create({
      baseURL: "https://api.subdl.com/api/v1",
      timeout: timeoutMs,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT }
    });
  }

  canDownload(fileId) {
    return String(fileId || "").startsWith("subdl_");
  }

  async search(mediaInfo, languages = []) {
    if (!this.apiKey) return [];
    if (!mediaInfo?.imdbId) return [];
    const params = {
      api_key: this.apiKey,
      imdb_id: mediaInfo.imdbId,
      type: mediaInfo.isEpisode ? "tv" : "movie",
      subs_per_page: 30
    };
    const converted = [...new Set(languages.map(toSubDLLanguage).filter(Boolean))];
    if (converted.length) params.languages = converted.join(",");
    if (mediaInfo.isEpisode) {
      params.season_number = mediaInfo.season || 1;
      params.episode_number = mediaInfo.episode;
    }
    const response = await this.client.get("/subtitles", { params, timeout: this.timeoutMs });
    const subtitles = Array.isArray(response.data?.subtitles) ? response.data.subtitles : [];
    return subtitles
      .map(subtitle => mapSubDLSubtitle(subtitle, mediaInfo))
      .filter(subtitle => subtitle && isWantedSubDLEpisode(subtitle, mediaInfo));
  }

  async download(fileId, options = {}) {
    const parsed = parseSubDLFileId(fileId);
    const url = `https://dl.subdl.com/subtitle/${parsed.subdlId}-${parsed.subtitleId}.zip`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: options.timeout || 18000,
      headers: { Accept: "*/*", "User-Agent": USER_AGENT }
    });
    const bytes = Buffer.from(response.data);
    const extracted = await extractSubtitleFromArchive(bytes, {
      providerName: "SubDL",
      sourceName: url,
      season: parsed.season,
      episode: parsed.episode,
      languageHint: options.languageHint
    });
    return extracted;
  }
}

class SubSourceProvider {
  constructor({ apiKey = "", timeoutMs = 12000 } = {}) {
    this.name = "subsource";
    this.apiKey = sanitizeHeaderValue(apiKey);
    this.timeoutMs = timeoutMs;
    this.directLinks = new Map();
    const headers = {
      Accept: "application/json, application/zip, application/octet-stream, text/plain, text/srt, text/vtt, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": USER_AGENT,
      Referer: "https://subsource.net/",
      Origin: "https://subsource.net"
    };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
      headers["api-key"] = this.apiKey;
    }
    this.client = axios.create({ baseURL: SUBSOURCE_BASE_URL, timeout: timeoutMs, headers, maxRedirects: 5 });
  }

  canDownload(fileId) {
    return String(fileId || "").startsWith("subsource_");
  }

  async search(mediaInfo, languages = []) {
    if (!this.apiKey || !mediaInfo?.imdbId) return [];
    const movieId = await this.getMovieId(mediaInfo.imdbId, mediaInfo.isEpisode ? mediaInfo.season : null);
    if (!movieId) return [];

    const params = {
      movieId,
      sort: "popular",
      limit: 100
    };
    const converted = [...new Set(languages.map(toSubSourceLanguage).filter(Boolean))];
    if (converted.length) params.language = converted.join(",");
    else if (languages.length) return [];

    let payload;
    try {
      const response = await this.client.get("/subtitles", { params, timeout: this.timeoutMs });
      payload = response.data;
    } catch (error) {
      if (error.response?.status !== 404) throw error;
      const response = await this.client.get("/search", { params, timeout: this.timeoutMs });
      payload = response.data;
    }

    const mapped = extractProviderArray(payload)
      .map(subtitle => this.mapSubtitle(subtitle))
      .filter(Boolean);
    return filterEpisodeSubtitles(mapped, mediaInfo, "subsource");
  }

  async getMovieId(imdbId, season = null) {
    const params = { searchType: "imdb", imdb: normalizeImdbForProvider(imdbId) };
    if (season) params.season = season;
    const response = await this.client.get("/movies/search", { params, timeout: this.timeoutMs });
    const movies = extractProviderArray(response.data);
    const first = movies[0] || {};
    return first.id || first.movieId || first.movie_id || "";
  }

  mapSubtitle(subtitle) {
    const subtitleId = subtitle.subtitleId || subtitle.id || subtitle.subtitle_id || subtitle._id;
    if (!subtitleId) return null;
    const languageCode = normalizeSubSourceLanguage(subtitle.language || subtitle.lang || subtitle.languageCode);
    if (!languageCode) return null;
    const name = releaseNameFromSubSource(subtitle);
    const directUrl = subtitle.download_url || subtitle.downloadUrl || subtitle.url || "";
    if (directUrl && /^https?:\/\//i.test(directUrl)) this.rememberDownloadLink(subtitleId, directUrl);
    return {
      id: `subsource_${subtitleId}`,
      fileId: `subsource_${subtitleId}`,
      languageCode,
      language: subtitle.language || languageCode,
      name,
      provider: "subsource",
      format: normalizeSubtitleFormat(subtitle.format || inferFormatFromName(name)),
      downloads: Number.parseInt(subtitle.downloads || subtitle.download_count || subtitle.downloadCount, 10) || 0,
      rating: subSourceRating(subtitle.rating || subtitle.score),
      uploadDate: subtitle.createdAt || subtitle.created_at || subtitle.uploadDate || subtitle.upload_date || "",
      hearing_impaired: isTrueFlag(subtitle.hearingImpaired) || isTrueFlag(subtitle.hearing_impaired) || isTrueFlag(subtitle.hi),
      downloadLink: directUrl,
      subsource_id: String(subtitleId)
    };
  }

  rememberDownloadLink(id, url) {
    this.directLinks.set(String(id), url);
    if (this.directLinks.size > 500) this.directLinks.delete(this.directLinks.keys().next().value);
  }

  async download(fileId, options = {}) {
    const parsed = parseProviderSeasonPackFileId(fileId, "subsource");
    let response;
    const cachedUrl = this.directLinks.get(parsed.id);
    if (cachedUrl) {
      response = await axios.get(cachedUrl, {
        responseType: "arraybuffer",
        timeout: options.timeout || this.timeoutMs,
        headers: { Accept: "*/*", "User-Agent": USER_AGENT, Referer: "https://subsource.net/" }
      });
    } else {
      response = await this.client.get(`/subtitles/${encodeURIComponent(parsed.id)}/download`, {
        responseType: "arraybuffer",
        timeout: options.timeout || this.timeoutMs
      });
    }
    return decodeProviderPayload(Buffer.from(response.data), {
      providerName: "SubSource",
      sourceName: cachedUrl || `subsource_${parsed.id}`,
      season: parsed.season,
      episode: parsed.episode,
      languageHint: options.languageHint
    });
  }
}

class SubsRoProvider {
  constructor({ apiKey = "", timeoutMs = 12000 } = {}) {
    this.name = "subsro";
    this.apiKey = sanitizeHeaderValue(apiKey);
    this.timeoutMs = timeoutMs;
    const headers = { Accept: "application/json", "User-Agent": USER_AGENT };
    if (this.apiKey) headers["X-Subs-Api-Key"] = this.apiKey;
    this.client = axios.create({ baseURL: SUBSRO_BASE_URL, timeout: timeoutMs, headers });
  }

  canDownload(fileId) {
    return String(fileId || "").startsWith("subsro_");
  }

  async search(mediaInfo, languages = []) {
    if (!this.apiKey) return [];
    const search = subsRoSearchTarget(mediaInfo);
    if (!search) return [];
    const converted = [...new Set(languages.map(toSubsRoLanguage).filter(Boolean))];
    if (!converted.length && languages.length) return [];

    const params = {};
    if (converted.length) params.language = converted.join(",");
    const response = await this.client.get(`/search/${search.field}/${encodeURIComponent(search.value)}`, {
      params,
      timeout: this.timeoutMs
    });
    if (response.data?.status !== 200) return [];
    const mapped = extractProviderArray(response.data?.items || response.data)
      .map(subtitle => mapSubsRoSubtitle(subtitle))
      .filter(Boolean);
    return filterEpisodeSubtitles(mapped, mediaInfo, "subsro");
  }

  async download(fileId, options = {}) {
    const parsed = parseProviderSeasonPackFileId(fileId, "subsro");
    const response = await this.client.get(`/subtitle/${encodeURIComponent(parsed.id)}/download`, {
      responseType: "arraybuffer",
      timeout: options.timeout || 20000
    });
    return decodeProviderPayload(Buffer.from(response.data), {
      providerName: "Subs.ro",
      sourceName: `subsro_${parsed.id}`,
      season: parsed.season,
      episode: parsed.episode,
      languageHint: options.languageHint
    });
  }
}

class StremioCommunityProvider {
  constructor({ timeoutMs = 15000, token = "" } = {}) {
    this.name = "stremio-community-subtitles";
    this.timeoutMs = timeoutMs;
    this.token = token || SCS_FALLBACK_TOKEN;
    this.client = axios.create({
      baseURL: SCS_BASE_URL,
      timeout: timeoutMs,
      headers: { "User-Agent": USER_AGENT }
    });
  }

  canDownload(fileId) {
    return String(fileId || "").startsWith("scs_");
  }

  async search(mediaInfo, _languages = [], extras = {}) {
    const contentId = buildStremioContentId(mediaInfo);
    if (!contentId) return [];
    const stremioType = mediaInfo.isEpisode ? "series" : "movie";
    const query = [];
    if (extras.videoHash) query.push(`videoHash=${encodeURIComponent(extras.videoHash)}`);
    if (extras.videoSize) query.push(`videoSize=${encodeURIComponent(extras.videoSize)}`);
    if (extras.filename) query.push(`filename=${encodeURIComponent(extras.filename)}`);
    const paramsJson = `${query.join("&")}.json`;
    const response = await this.client.get(`/${this.token}/subtitles/${stremioType}/${contentId}/${paramsJson}`, { timeout: this.timeoutMs });
    const subtitles = Array.isArray(response.data?.subtitles) ? response.data.subtitles : [];
    const firstByLanguage = new Set();
    return subtitles.map((subtitle, index) => {
      const languageCode = normalizeLanguageCode(subtitle.lang || subtitle.language || "");
      if (!languageCode) return null;
      const identifier = extractScsDownloadIdentifier(subtitle.url || subtitle.id || "");
      if (!identifier) return null;
      const firstForLanguage = !firstByLanguage.has(languageCode);
      firstByLanguage.add(languageCode);
      return {
        id: `scs_${identifier}`,
        fileId: `scs_${identifier}`,
        languageCode,
        language: subtitle.lang || languageCode,
        name: extras.videoHash && firstForLanguage ? "[SCS] Hash Match" : "[SCS] Community Subtitle",
        provider: "stremio-community-subtitles",
        format: "vtt",
        hashMatch: Boolean(extras.videoHash && firstForLanguage),
        hashMatchPriority: index,
        downloadLink: subtitle.url || ""
      };
    }).filter(Boolean);
  }

  async download(fileId, options = {}) {
    const identifier = String(fileId || "").replace(/^scs_/, "");
    const response = await this.client.get(`/${this.token}/download/${encodeURIComponent(identifier)}.vtt`, {
      responseType: "arraybuffer",
      timeout: options.timeout || this.timeoutMs
    });
    return decodeProviderPayload(Buffer.from(response.data), {
      sourceName: `${identifier}.vtt`,
      providerName: "SCS",
      languageHint: options.languageHint
    });
  }
}

class WyzieProvider {
  constructor({ apiKey = "", timeoutMs = 12000 } = {}) {
    this.name = "wyzie";
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.client = axios.create({
      baseURL: WYZIE_BASE_URL,
      timeout: timeoutMs,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT }
    });
  }

  canDownload(fileId) {
    return String(fileId || "").startsWith("wyzie_");
  }

  async search(mediaInfo, languages = []) {
    if (!this.apiKey) return [];
    const searchId = mediaInfo?.imdbId || mediaInfo?.tmdbId;
    if (!searchId) return [];
    const params = new URLSearchParams();
    params.set("id", searchId);
    params.set("key", this.apiKey);
    params.set("format", "srt");
    const iso1 = [...new Set(languages.map(toISO6391).map(code => (code || "").split("-")[0]).filter(code => /^[a-z]{2}$/.test(code)))];
    if (iso1.length) params.set("language", iso1.join(","));
    if (mediaInfo.isEpisode) {
      params.set("season", mediaInfo.season || 1);
      params.set("episode", mediaInfo.episode);
    }
    const response = await this.client.get(`/search?${params.toString()}`, { timeout: this.timeoutMs });
    const subtitles = Array.isArray(response.data) ? response.data : [];
    return subtitles.map(subtitle => {
      const url = subtitle.url || "";
      if (!url) return null;
      const languageCode = normalizeLanguageCode(subtitle.language);
      if (!languageCode) return null;
      return {
        id: `wyzie_${Buffer.from(url).toString("base64url")}`,
        fileId: `wyzie_${Buffer.from(url).toString("base64url")}`,
        languageCode,
        language: subtitle.language || languageCode,
        name: subtitle.release || subtitle.fileName || subtitle.media || "[Wyzie] Subtitle",
        provider: "wyzie",
        format: normalizeSubtitleFormat(subtitle.format || "srt"),
        hearing_impaired: subtitle.isHearingImpaired === true,
        downloads: Number.parseInt(subtitle.downloadCount, 10) || 0,
        downloadLink: url
      };
    }).filter(Boolean);
  }

  async download(fileId, options = {}) {
    const url = Buffer.from(String(fileId || "").slice("wyzie_".length), "base64url").toString("utf8");
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: options.timeout || this.timeoutMs,
      headers: { Accept: "text/plain, text/vtt, application/x-subrip, */*" }
    });
    return decodeProviderPayload(Buffer.from(response.data), {
      sourceName: url,
      providerName: "Wyzie",
      languageHint: options.languageHint
    });
  }
}

function mapSubDLSubtitle(subtitle, mediaInfo) {
  const urlMatch = String(subtitle.url || "").match(/\/subtitle\/(\d+)-(\d+)\.zip/);
  if (!urlMatch) return null;
  const languageCode = normalizeLanguageCode(subtitle.lang || subtitle.language || "");
  if (!languageCode) return null;
  let fileId = `subdl_${urlMatch[1]}_${urlMatch[2]}`;
  if (mediaInfo.isEpisode && isSubDLSeasonPack(subtitle)) fileId += `_seasonpack_s${mediaInfo.season || 1}e${mediaInfo.episode}`;
  return {
    id: fileId,
    fileId,
    languageCode,
    language: subtitle.lang || languageCode,
    name: subtitle.release_name || subtitle.name || "SubDL subtitle",
    provider: "subdl",
    format: "srt",
    downloads: Number.parseInt(subtitle.download_count, 10) || 0,
    rating: Number.parseFloat(subtitle.rating) || 0,
    uploadDate: subtitle.upload_date || subtitle.created_at || "",
    downloadLink: subtitle.url || "",
    hearing_impaired: subtitle.hi === 1 || subtitle.hearing_impaired === true,
    is_season_pack: mediaInfo.isEpisode && isSubDLSeasonPack(subtitle),
    providerEpisode: subtitle.episode
  };
}

function isSubDLSeasonPack(subtitle) {
  const from = subtitle.episode_from;
  const to = subtitle.episode_end;
  return (from != null && to != null && Number(from) !== Number(to)) || subtitle.episode == null;
}

function isWantedSubDLEpisode(subtitle, mediaInfo) {
  if (!mediaInfo.isEpisode || subtitle.is_season_pack) return true;
  const episode = Number(subtitle.providerEpisode);
  return !Number.isFinite(episode) || episode === Number(mediaInfo.episode);
}

function parseSubDLFileId(fileId) {
  const match = String(fileId || "").match(/^subdl_(\d+)_(\d+)(?:_seasonpack_s(\d+)e(\d+))?$/i);
  if (!match) throw new Error("Invalid SubDL file id.");
  return {
    subdlId: match[1],
    subtitleId: match[2],
    season: match[3] ? Number.parseInt(match[3], 10) : null,
    episode: match[4] ? Number.parseInt(match[4], 10) : null
  };
}

function parseProviderSeasonPackFileId(fileId, prefix) {
  const pattern = new RegExp(`^${prefix}_([^_]+)(?:_seasonpack_s(\\d+)e(\\d+))?$`, "i");
  const match = String(fileId || "").match(pattern);
  if (!match) throw new Error(`Invalid ${prefix} file id.`);
  return {
    id: match[1],
    season: match[2] ? Number.parseInt(match[2], 10) : null,
    episode: match[3] ? Number.parseInt(match[3], 10) : null
  };
}

function toSubDLLanguage(language) {
  const code = String(language || "").toLowerCase();
  const map = {
    eng: "EN",
    spa: "ES",
    spn: "ES",
    fre: "FR",
    fra: "FR",
    ger: "DE",
    deu: "DE",
    por: "PT",
    pob: "BR_PT",
    chi: "ZH",
    zho: "ZH",
    zhs: "ZH",
    zht: "ZH",
    jpn: "JA",
    kor: "KO",
    ara: "AR",
    rus: "RU",
    ita: "IT"
  };
  if (map[code]) return map[code];
  const iso1 = toISO6391(code);
  return iso1 && /^[a-z]{2}$/i.test(iso1) ? iso1.toUpperCase() : "";
}

function toSubSourceLanguage(language) {
  const code = String(language || "").toLowerCase();
  const map = {
    eng: "english",
    spa: "spanish",
    spn: "spanish_latin_america",
    fre: "french",
    fra: "french",
    ger: "german",
    deu: "german",
    por: "portuguese",
    pob: "brazilian_portuguese",
    ita: "italian",
    rus: "russian",
    jpn: "japanese",
    kor: "korean",
    chi: "chinese",
    zho: "chinese",
    zhs: "chinese_simplified",
    zht: "chinese_traditional",
    ara: "arabic",
    dut: "dutch",
    nld: "dutch",
    pol: "polish",
    tur: "turkish",
    swe: "swedish",
    dan: "danish",
    fin: "finnish",
    nor: "norwegian",
    nob: "norwegian",
    nno: "norwegian",
    heb: "hebrew",
    hin: "hindi",
    tha: "thai",
    vie: "vietnamese",
    ind: "indonesian",
    rum: "romanian",
    ron: "romanian",
    cze: "czech",
    ces: "czech",
    hun: "hungarian",
    gre: "greek",
    ell: "greek",
    bul: "bulgarian",
    hrv: "croatian",
    ukr: "ukrainian",
    per: "farsi_persian",
    fas: "farsi_persian",
    tgl: "tagalog",
    fil: "tagalog",
    cat: "catalan"
  };
  if (map[code]) return map[code];
  const iso1 = toISO6391(code);
  const iso1Map = {
    en: "english",
    es: "spanish",
    fr: "french",
    de: "german",
    pt: "portuguese",
    it: "italian",
    ru: "russian",
    ja: "japanese",
    ko: "korean",
    zh: "chinese",
    ar: "arabic",
    nl: "dutch",
    pl: "polish",
    tr: "turkish",
    sv: "swedish",
    da: "danish",
    fi: "finnish",
    no: "norwegian",
    he: "hebrew",
    hi: "hindi",
    th: "thai",
    vi: "vietnamese",
    id: "indonesian",
    ro: "romanian",
    cs: "czech",
    hu: "hungarian",
    el: "greek",
    bg: "bulgarian",
    hr: "croatian",
    uk: "ukrainian",
    fa: "farsi_persian",
    ca: "catalan"
  };
  return iso1Map[iso1] || "";
}

function normalizeSubSourceLanguage(language) {
  const raw = String(language || "").toLowerCase().trim();
  const map = {
    english: "eng",
    spanish: "spa",
    "spanish_latin_america": "spn",
    "spanish (latin america)": "spn",
    french: "fre",
    german: "ger",
    portuguese: "por",
    "brazilian_portuguese": "pob",
    "portuguese (brazil)": "pob",
    italian: "ita",
    russian: "rus",
    japanese: "jpn",
    korean: "kor",
    chinese: "chi",
    "chinese_simplified": "zhs",
    "chinese (simplified)": "zhs",
    "chinese_traditional": "zht",
    "chinese (traditional)": "zht",
    arabic: "ara",
    dutch: "dut",
    polish: "pol",
    turkish: "tur",
    swedish: "swe",
    danish: "dan",
    finnish: "fin",
    norwegian: "nor",
    hebrew: "heb",
    hindi: "hin",
    thai: "tha",
    vietnamese: "vie",
    indonesian: "ind",
    romanian: "rum",
    czech: "cze",
    hungarian: "hun",
    greek: "ell",
    bulgarian: "bul",
    croatian: "hrv",
    ukrainian: "ukr",
    "farsi_persian": "per",
    farsi: "per",
    persian: "per",
    tagalog: "tgl",
    filipino: "tgl",
    catalan: "cat"
  };
  return map[raw] || normalizeLanguageCode(raw);
}

function toSubsRoLanguage(language) {
  const code = String(language || "").toLowerCase();
  const map = {
    rum: "ro",
    ron: "ro",
    eng: "en",
    ita: "ita",
    fre: "fra",
    fra: "fra",
    ger: "ger",
    deu: "ger",
    hun: "ung",
    ell: "gre",
    gre: "gre",
    por: "por",
    pob: "por",
    spa: "spa",
    spn: "spa"
  };
  if (map[code]) return map[code];
  const iso1 = toISO6391(code);
  return {
    ro: "ro",
    en: "en",
    it: "ita",
    fr: "fra",
    de: "ger",
    hu: "ung",
    el: "gre",
    pt: "por",
    es: "spa"
  }[iso1] || "";
}

function normalizeSubsRoLanguage(language) {
  return {
    ro: "rum",
    en: "eng",
    ita: "ita",
    fra: "fre",
    ger: "ger",
    ung: "hun",
    gre: "ell",
    por: "por",
    spa: "spa",
    alt: ""
  }[String(language || "").toLowerCase().trim()] || normalizeLanguageCode(language);
}

function releaseNameFromSubSource(subtitle) {
  if (Array.isArray(subtitle.releaseInfo) && subtitle.releaseInfo.length) return subtitle.releaseInfo.join(" / ");
  const candidates = [
    subtitle.releaseInfo,
    subtitle.name,
    subtitle.release_name,
    subtitle.releaseName,
    subtitle.fullname,
    subtitle.fullName,
    subtitle.file_name,
    subtitle.fileName,
    subtitle.filename,
    subtitle.title,
    subtitle.subtitle_name,
    subtitle.subtitleName,
    subtitle.description,
    subtitle.release
  ];
  const found = candidates.find(value => String(value || "").trim());
  return String(found || `SubSource ${subtitle.language || "subtitle"}`).trim();
}

function subSourceRating(rating) {
  if (rating && typeof rating === "object") {
    const good = Number.parseInt(rating.good, 10) || 0;
    const bad = Number.parseInt(rating.bad, 10) || 0;
    const total = good + bad;
    if (!total) return 0;
    return ((good + 3.5) / (total + 5)) * 10;
  }
  return Number.parseFloat(rating) || 0;
}

function mapSubsRoSubtitle(subtitle) {
  const id = subtitle.id || subtitle.subtitleId;
  if (!id) return null;
  const languageCode = normalizeSubsRoLanguage(subtitle.language);
  if (!languageCode) return null;
  let name = subtitle.description || "";
  if (!name && subtitle.title) name = subtitle.year ? `${subtitle.title} (${subtitle.year})` : subtitle.title;
  if (subtitle.translator && name && !name.includes(subtitle.translator)) name = `[${subtitle.translator}] ${name}`;
  if (!name) name = `[Subs.ro] ${subtitle.language || "subtitle"}`;
  return {
    id: `subsro_${id}`,
    fileId: `subsro_${id}`,
    languageCode,
    language: subtitle.language || languageCode,
    name,
    provider: "subsro",
    format: inferFormatFromName(name),
    downloads: 0,
    rating: 0,
    uploadDate: subtitle.createdAt || subtitle.updatedAt || "",
    downloadLink: subtitle.downloadLink || subtitle.link || "",
    hearing_impaired: /\[(?:hi|sdh|cc)\]|\((?:hi|sdh|cc)\)|\.hi\.|\.sdh\.|hearing.?impaired|closed.?caption/i.test(name)
  };
}

function subsRoSearchTarget(mediaInfo) {
  if (mediaInfo?.imdbId) return { field: "imdbid", value: normalizeImdbForProvider(mediaInfo.imdbId).replace(/^tt/i, "") };
  if (mediaInfo?.tmdbId) return { field: "tmdbid", value: String(mediaInfo.tmdbId).replace(/^tt/i, "") };
  return null;
}

function filterEpisodeSubtitles(subtitles, mediaInfo, providerName) {
  if (!mediaInfo?.isEpisode || !mediaInfo.episode) return subtitles;
  const targetSeason = Number(mediaInfo.season || 1);
  const targetEpisode = Number(mediaInfo.episode);
  return subtitles.filter(subtitle => {
    const name = String(subtitle.name || subtitle.downloadLink || "").toLowerCase();
    if (hasExplicitSeasonEpisodeMismatch(name, targetSeason, targetEpisode)) return false;
    if (nameLooksSeasonPack(name, targetSeason, targetEpisode, mediaInfo.type === "anime")) {
      subtitle.is_season_pack = true;
      const originalFileId = subtitle.fileId || subtitle.id;
      subtitle.fileId = `${originalFileId}_seasonpack_s${targetSeason}e${targetEpisode}`;
      subtitle.id = subtitle.fileId;
      return true;
    }
    const matchesEpisode = nameLooksEpisode(name, targetSeason, targetEpisode, mediaInfo.type === "anime");
    if (!matchesEpisode && providerName === "subsro" && subtitle.type === "series") return true;
    return matchesEpisode;
  });
}

function hasExplicitSeasonEpisodeMismatch(name, season, episode) {
  const normalized = String(name || "").toLowerCase();
  const patterns = [
    { regex: /\bs0*(\d{1,2})[.\s_-]*e0*(\d{1,3})\b/i, season: 1, episode: 2 },
    { regex: /\b0*(\d{1,2})x0*(\d{1,3})\b/i, season: 1, episode: 2 },
    { regex: /\bseason\s*0*(\d{1,2}).*?\bepisode\s*0*(\d{1,3})\b/i, season: 1, episode: 2 }
  ];
  for (const item of patterns) {
    const match = normalized.match(item.regex);
    if (!match) continue;
    if (Number(match[item.season]) !== Number(season) || Number(match[item.episode]) !== Number(episode)) return true;
  }
  return false;
}

function nameLooksSeasonPack(name, season, episode, isAnime) {
  const normalized = String(name || "").toLowerCase();
  const episodeExclusion = new RegExp(`(?:^|[^0-9])0*${episode}(?:v\\d+)?(?:[^0-9]|$)`, "i");
  const hasEpisodeNumber = /s0*\d+e0*\d+|\d+x\d+|episode\s*\d+|ep\.?\s*\d+|\be\.?\s*\d{1,3}\b/i.test(normalized);
  const tvPatterns = [
    new RegExp(`(?:complete|full|entire)?\\s*(?:season|s)\\s*0*${season}(?:\\s+(?:complete|full|pack))?(?!.*e0*\\d)`, "i"),
    new RegExp(`s0*${season}\\s*(?:complete|full|pack)`, "i"),
    /\d{1,3}\s*[-~]\s*\d{1,3}\s*(?:complete|batch|full|pack|\]|$)/i,
    /\[(?:batch|complete|full)\]/i
  ];
  const animePatterns = [
    /(?:complete|batch|full(?:\s+series)?|\d{1,2}\s*[-~]\s*\d{1,2})/i,
    /\[(?:batch|complete|full)\]/i,
    /(?:episode\s*)?(?:01|001)\s*[-~]\s*(?:\d{2}|\d{3})/i
  ];
  if (isAnime) return animePatterns.some(pattern => pattern.test(normalized)) && !episodeExclusion.test(normalized);
  return tvPatterns.some(pattern => pattern.test(normalized)) && !hasEpisodeNumber;
}

function nameLooksEpisode(name, season, episode, isAnime) {
  const normalized = String(name || "").toLowerCase();
  const patterns = [
    new RegExp(`s0*${season}e0*${episode}(?![0-9])`, "i"),
    new RegExp(`${season}x0*${episode}(?![0-9])`, "i"),
    new RegExp(`s0*${season}[\\s._-]*x[\\s._-]*e?0*${episode}(?![0-9])`, "i"),
    new RegExp(`season\\s*0*${season}.*episode\\s*0*${episode}(?![0-9])`, "i")
  ];
  if (patterns.some(pattern => pattern.test(normalized))) return true;
  if (!isAnime) return false;
  return [
    new RegExp(`(?:^|[\\s\\[\\(\\-_])e?p?\\s*0*${episode}(?:v\\d+)?(?=$|[\\s\\[\\]\\(\\)\\-_.])`, "i"),
    new RegExp(`(?:^|[\\s\\[\\(\\-_])0*${episode}(?:v\\d+)?(?=$|[\\s\\[\\]\\(\\)\\-_.])`, "i"),
    new RegExp(`(?:episode|episodio|ep|cap(?:itulo)?)\\s*0*${episode}(?![0-9])`, "i")
  ].some(pattern => pattern.test(normalized));
}

function extractProviderArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.subtitles)) return payload.subtitles;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.subtitles)) return payload.data.subtitles;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  return [];
}

function normalizeImdbForProvider(imdbId) {
  const digits = String(imdbId || "").replace(/^tt/i, "");
  return /^\d+$/.test(digits) ? `tt${digits}` : String(imdbId || "");
}

function sanitizeHeaderValue(value) {
  return String(value || "").replace(/[^\x20-\x7e]/g, "").trim();
}

function isTrueFlag(value) {
  if (value === true || value === 1) return true;
  return /^(1|true|yes|y)$/i.test(String(value || ""));
}

function buildStremioContentId(mediaInfo) {
  if (mediaInfo.imdbId) {
    if (mediaInfo.isEpisode && mediaInfo.season && mediaInfo.episode) return `${mediaInfo.imdbId}:${mediaInfo.season}:${mediaInfo.episode}`;
    return mediaInfo.imdbId;
  }
  if (mediaInfo.animeId) {
    if (mediaInfo.isEpisode && mediaInfo.season && mediaInfo.episode) return `${mediaInfo.animeId}:${mediaInfo.season}:${mediaInfo.episode}`;
    if (mediaInfo.isEpisode && mediaInfo.episode) return `${mediaInfo.animeId}:${mediaInfo.episode}`;
    return mediaInfo.animeId;
  }
  return "";
}

function extractScsDownloadIdentifier(value) {
  const text = String(value || "");
  const fromUrl = text.match(/\/download\/([^/?#.]+)(?:\.[a-z0-9]+)?/i)?.[1];
  const identifier = fromUrl || text.replace(/^scs_/, "");
  return /^[A-Za-z0-9_-]+$/.test(identifier) ? identifier : "";
}

async function decodeProviderPayload(bytes, options = {}) {
  if (isArchive(bytes)) return extractSubtitleFromArchive(bytes, options);
  const analysis = analyzeResponseContent(bytes);
  if (analysis.type !== "subtitle" && analysis.type !== "unknown") {
    throw new Error(`${options.providerName || "Provider"} returned ${analysis.type}: ${analysis.hint}`);
  }
  const content = detectAndConvertEncoding(bytes, options.providerName || "provider", options.languageHint || null);
  const format = normalizeSubtitleFormat(detectSubtitleFormat(content, inferFormatFromName(options.sourceName || "")));
  if (!content.trim()) throw new Error("Downloaded subtitle is empty.");
  return { content, format, name: options.sourceName || "" };
}

module.exports = {
  ProviderManager,
  StremioCommunityProvider,
  SubDLProvider,
  SubSourceProvider,
  SubsRoProvider,
  WyzieProvider,
  buildProviders,
  decodeProviderPayload
};
