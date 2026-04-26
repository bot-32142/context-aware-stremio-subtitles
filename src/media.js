const path = require("node:path");

function parseStremioId(type, id) {
  const rawId = String(id || "").trim();
  const match = rawId.match(/^(tt\d+)(?::(\d+):(\d+))?$/i);
  if (!match) return null;

  const rootId = match[1].toLowerCase();
  const season = match[2] ? Number.parseInt(match[2], 10) : null;
  const episode = match[3] ? Number.parseInt(match[3], 10) : null;
  const normalizedType = normalizeStremioType(type, season, episode);

  return {
    type: normalizedType,
    stremioType: String(type || "").trim().toLowerCase(),
    rawId,
    rootId,
    imdbId: rootId,
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

function mediaContextKey(mediaInfo, targetLanguage) {
  if (!mediaInfo || !mediaInfo.rootId) {
    throw new Error("Cannot build book key without media information.");
  }
  const scope = mediaInfo.type === "movie" ? "movie" : mediaInfo.type === "anime" ? "anime" : "series";
  return `${scope}:${mediaInfo.rootId}:${String(targetLanguage || "").toLowerCase()}`;
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
  parseStremioId
};
