const fs = require("node:fs/promises");
const path = require("node:path");
const log = require("./logger");

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const ANIME_LIST_URL = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";

class IdResolver {
  constructor({ dataDir, fetchImpl = globalThis.fetch, timeoutMs = 8000, animeListUrl = ANIME_LIST_URL } = {}) {
    this.dataDir = dataDir || path.join(process.cwd(), "data");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.animeListUrl = animeListUrl;
    this.tmdbCache = new Map();
    this.animeMapsPromise = null;
  }

  async resolve(mediaInfo) {
    if (!mediaInfo) return null;
    const resolved = { ...mediaInfo };
    if (!resolved.imdbId && resolved.tmdbId) {
      const imdbId = await this.resolveTmdbToImdb(resolved.tmdbId).catch(error => {
        log.warn(() => `[ID Resolver] TMDB to IMDB lookup failed: ${error.message}`);
        return "";
      });
      if (imdbId) resolved.imdbId = imdbId;
    }
    if (!resolved.imdbId && resolved.animeIdType && resolved.animeNumericId) {
      const anime = await this.resolveAnimeId(resolved.animeIdType, resolved.animeNumericId).catch(error => {
        log.warn(() => `[ID Resolver] anime lookup failed: ${error.message}`);
        return null;
      });
      if (anime?.imdbId) resolved.imdbId = anime.imdbId;
      if (anime?.tmdbId && !resolved.tmdbId) resolved.tmdbId = anime.tmdbId;
    }
    if (!resolved.imdbId && resolved.tmdbId) {
      const imdbId = await this.resolveTmdbToImdb(resolved.tmdbId).catch(error => {
        log.warn(() => `[ID Resolver] anime TMDB to IMDB lookup failed: ${error.message}`);
        return "";
      });
      if (imdbId) resolved.imdbId = imdbId;
    }
    return resolved;
  }

  async resolveTmdbToImdb(tmdbId) {
    const normalized = String(tmdbId || "").replace(/^tmdb:/, "").trim();
    if (!/^\d+$/.test(normalized)) return "";
    if (this.tmdbCache.has(normalized)) return this.tmdbCache.get(normalized);
    if (typeof this.fetch !== "function") return "";

    const query = buildTmdbToImdbWikidataQuery(normalized);
    const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
    const response = await fetchWithTimeout(this.fetch, url, {
      timeoutMs: this.timeoutMs,
      headers: { Accept: "application/sparql-results+json", "User-Agent": "context-aware-stremio-subtitles/0.1" }
    });
    if (!response.ok) throw new Error(`Wikidata returned HTTP ${response.status}.`);
    const payload = await response.json();
    const imdbId = payload?.results?.bindings?.[0]?.imdb?.value || "";
    const normalizedImdb = normalizeImdbId(imdbId);
    this.tmdbCache.set(normalized, normalizedImdb);
    return normalizedImdb;
  }

  async resolveAnimeId(platform, id) {
    const maps = await this.loadAnimeMaps();
    const map = maps.get(String(platform || "").toLowerCase());
    return map?.get(String(id || "")) || null;
  }

  async loadAnimeMaps() {
    if (!this.animeMapsPromise) this.animeMapsPromise = this._loadAnimeMaps();
    return this.animeMapsPromise;
  }

  async _loadAnimeMaps() {
    const filePath = path.join(this.dataDir, "anime-list-full.json");
    let text = await readTextIfExists(filePath);
    if (!text && typeof this.fetch === "function") {
      log.info(() => "[ID Resolver] Downloading Fribb anime-list-full.json for anime ID mapping.");
      const response = await fetchWithTimeout(this.fetch, this.animeListUrl, { timeoutMs: this.timeoutMs });
      if (response.ok) {
        text = await response.text();
        await fs.mkdir(this.dataDir, { recursive: true });
        await fs.writeFile(filePath, text, "utf8");
      }
    }
    const maps = new Map([
      ["kitsu", new Map()],
      ["mal", new Map()],
      ["myanimelist", new Map()],
      ["anidb", new Map()],
      ["anilist", new Map()],
      ["tmdb", new Map()],
      ["tvdb", new Map()]
    ]);
    if (!text) return maps;
    const entries = JSON.parse(text);
    if (!Array.isArray(entries)) return maps;
    for (const entry of entries) {
      const meta = {
        imdbId: normalizeImdbId(entry.imdb_id),
        tmdbId: positiveString(entry.themoviedb_id),
        tvdbId: positiveString(entry.thetvdb_id),
        type: entry.type || null,
        season: positiveNumber(entry.defaulttvdbseason)
      };
      addAnimeMap(maps.get("kitsu"), entry.kitsu_id, meta);
      addAnimeMap(maps.get("mal"), entry.mal_id, meta);
      addAnimeMap(maps.get("myanimelist"), entry.mal_id, meta);
      addAnimeMap(maps.get("anidb"), entry.anidb_id, meta);
      addAnimeMap(maps.get("anilist"), entry.anilist_id, meta);
      addAnimeMap(maps.get("tmdb"), entry.themoviedb_id, meta);
      addAnimeMap(maps.get("tvdb"), entry.thetvdb_id, meta);
    }
    return maps;
  }
}

function buildTmdbToImdbWikidataQuery(tmdbId) {
  return `
    SELECT ?imdb WHERE {
      { ?item wdt:P4947 "${tmdbId}". }
      UNION
      { ?item wdt:P4983 "${tmdbId}". }
      ?item wdt:P345 ?imdb.
    } LIMIT 1
  `.trim().replace(/\s+/g, " ");
}

function addAnimeMap(map, rawId, meta) {
  const id = positiveString(rawId);
  if (!id || (!meta.imdbId && !meta.tmdbId)) return;
  map.set(id, meta);
}

function normalizeImdbId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/^tt/i, "");
  return /^\d+$/.test(digits) ? `tt${digits}` : "";
}

function positiveString(value) {
  const raw = String(value ?? "").trim();
  return /^\d+$/.test(raw) && Number(raw) > 0 ? raw : "";
}

function positiveNumber(value) {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

async function fetchWithTimeout(fetchImpl, url, { timeoutMs, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

module.exports = {
  ANIME_LIST_URL,
  IdResolver,
  buildTmdbToImdbWikidataQuery,
  normalizeImdbId
};
