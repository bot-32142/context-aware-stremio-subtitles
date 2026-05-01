const path = require("node:path");

function parseStremioId(type, id) {
  const rawId = String(id || "").trim();
  const parts = rawId.split(":");
  const first = String(parts[0] || "").toLowerCase();
  let rootId = "";
  let imdbId = "";
  let tmdbId = "";
  let animeId = "";
  let animeIdType = "";
  let animeNumericId = "";
  let season = null;
  let episode = null;

  if (/^tt\d+$/i.test(first)) {
    rootId = first;
    imdbId = first;
    season = parts[1] ? Number.parseInt(parts[1], 10) : null;
    episode = parts[2] ? Number.parseInt(parts[2], 10) : null;
  } else if (first === "tmdb" && /^\d+$/.test(parts[1] || "")) {
    tmdbId = parts[1];
    rootId = `tmdb:${tmdbId}`;
    if (parts.length >= 4) {
      season = Number.parseInt(parts[2], 10);
      episode = Number.parseInt(parts[3], 10);
    } else if (parts.length === 3 && normalizeStremioType(type, null, Number.parseInt(parts[2], 10)) !== "movie") {
      season = 1;
      episode = Number.parseInt(parts[2], 10);
    }
  } else if (isAnimePrefix(first) && /^\d+$/.test(parts[1] || "")) {
    animeIdType = first === "myanimelist" ? "mal" : first;
    animeNumericId = parts[1];
    animeId = `${animeIdType}:${animeNumericId}`;
    rootId = animeId;
    if (parts.length >= 4) {
      season = Number.parseInt(parts[2], 10);
      episode = Number.parseInt(parts[3], 10);
    } else if (parts.length === 3) {
      season = 1;
      episode = Number.parseInt(parts[2], 10);
    }
  } else {
    return null;
  }

  if ((season !== null && Number.isNaN(season)) || (episode !== null && Number.isNaN(episode))) return null;
  const normalizedType = normalizeStremioType(type, season, episode);

  return {
    type: normalizedType,
    stremioType: String(type || "").trim().toLowerCase(),
    rawId,
    rootId,
    imdbId,
    tmdbId,
    animeId,
    animeIdType,
    animeNumericId,
    season,
    episode,
    isEpisode: season !== null && episode !== null
  };
}

function normalizeStremioType(type, season, episode) {
  const rawType = String(type || "").trim().toLowerCase();
  if (rawType === "anime") return "anime";
  if (rawType === "series" || season !== null || episode !== null) return "series";
  return "movie";
}

function isAnimePrefix(value) {
  return ["anidb", "kitsu", "mal", "myanimelist", "anilist", "tvdb"].includes(String(value || "").toLowerCase());
}

function mediaContextKey(mediaInfo, targetLanguage) {
  if (!mediaInfo || !mediaInfo.rootId) {
    throw new Error("Cannot build book key without media information.");
  }
  const scope = mediaInfo.type === "movie" ? "movie" : mediaInfo.type === "anime" ? "anime" : "series";
  return `${scope}:${mediaInfo.rootId}:${String(targetLanguage || "").toLowerCase()}`;
}

function mediaTranslationKey(mediaInfo, targetLanguage) {
  if (!mediaInfo || !mediaInfo.rootId) {
    throw new Error("Cannot build translation key without media information.");
  }
  const scope = mediaInfo.type === "movie" ? "movie" : mediaInfo.type === "anime" ? "anime" : "series";
  const target = String(targetLanguage || "").toLowerCase();
  if (mediaInfo.isEpisode) return `${scope}:${mediaInfo.rootId}:${mediaInfo.season}:${mediaInfo.episode}:${target}`;
  return `${scope}:${mediaInfo.rootId}:${target}`;
}

function mediaBookName(mediaInfo, targetLanguage, filename = "") {
  const maybeName = path.basename(String(filename || "")).replace(/\.[^.]+$/, "").trim();
  const label = mediaInfo?.type === "movie" ? "Movie" : mediaInfo?.type === "anime" ? "Anime" : "Series";
  const root = mediaInfo?.rootId || "unknown";
  const stableName = `${label} ${root}`;
  if (!maybeName) return `${stableName} -> ${targetLanguage}`;

  const cleaned = maybeName
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${stableName} (${cleaned}) -> ${targetLanguage}`;
}

module.exports = {
  mediaBookName,
  mediaContextKey,
  mediaTranslationKey,
  parseStremioId
};
