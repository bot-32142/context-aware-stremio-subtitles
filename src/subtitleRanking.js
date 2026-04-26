function finalizeSubtitleResults(subtitles, requestedLanguages, config, { filename = "" } = {}) {
  const requested = expandRequestedLanguageSet(requestedLanguages);
  let processed = Array.isArray(subtitles) ? subtitles.filter(Boolean) : [];
  if (requested.size) processed = processed.filter(subtitle => requested.has(subtitle.languageCode));
  if (config.excludeHearingImpairedSubtitles) processed = processed.filter(subtitle => !subtitle.hearing_impaired);
  if (config.deduplicateSubtitles !== false) processed = deduplicateSubtitles(processed);
  return rankAndLimitSubtitles(processed, { filename, maxPerLanguage: config.maxSubtitlesPerLanguage });
}

function expandRequestedLanguageSet(languages = []) {
  const equivalents = {
    chi: ["zhs", "zht", "zho", "ze"],
    zhs: ["chi", "zht", "zho", "ze"],
    zht: ["chi", "zhs", "zho", "ze"],
    spa: ["spn"],
    spn: ["spa"],
    nor: ["nob", "nno"],
    nob: ["nor", "nno"],
    nno: ["nor", "nob"],
    per: ["fas", "prs"],
    fas: ["per", "prs"],
    prs: ["per", "fas"],
    tgl: ["fil"],
    fil: ["tgl"]
  };
  const set = new Set();
  for (const language of languages || []) {
    const code = String(language || "").toLowerCase();
    if (!code) continue;
    set.add(code);
    for (const equivalent of equivalents[code] || []) set.add(equivalent);
  }
  return set;
}

function deduplicateSubtitles(subtitles) {
  const seen = new Set();
  const result = [];
  for (const subtitle of subtitles) {
    const key = [
      subtitle.languageCode || "unknown",
      normalizeReleaseName(subtitle.name || subtitle.downloadLink || subtitle.fileId),
      subtitle.hearing_impaired ? "hi" : "regular",
      subtitle.is_season_pack ? "seasonpack" : "episode",
      String(subtitle.format || "srt").toLowerCase()
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(subtitle);
  }
  return result;
}

function rankAndLimitSubtitles(subtitles, { filename, maxPerLanguage }) {
  const scored = subtitles
    .map((subtitle, index) => ({
      subtitle,
      index,
      score: scoreSubtitle(subtitle, filename)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const counts = new Map();
  const limited = [];
  const max = Number.isFinite(maxPerLanguage) && maxPerLanguage > 0 ? maxPerLanguage : 5;
  for (const item of scored) {
    const lang = item.subtitle.languageCode || "unknown";
    const count = counts.get(lang) || 0;
    if (count >= max) continue;
    counts.set(lang, count + 1);
    limited.push(item.subtitle);
  }
  return limited;
}

function scoreSubtitle(subtitle, filename) {
  let score = 0;
  if (subtitle.hashMatch) score += 200000 - (subtitle.hashMatchPriority || 0);
  const stream = parseReleaseMetadata(filename);
  const sub = parseReleaseMetadata(`${subtitle.name || ""} ${subtitle.downloadLink || ""}`);

  if (stream.titleBase && sub.titleBase && normalizeReleaseName(sub.titleBase).includes(normalizeReleaseName(stream.titleBase))) score += 500;
  if (stream.group && sub.group) score += stream.group === sub.group ? 5000 : -100;
  if (stream.source && sub.source) score += stream.source === sub.source ? 2500 : adjacentSource(stream.source, sub.source) ? 600 : -400;
  if (stream.platform && sub.platform) score += stream.platform === sub.platform ? 1200 : -150;
  if (stream.resolution && sub.resolution) score += stream.resolution === sub.resolution ? 900 : 100;
  if (stream.codec && sub.codec) score += stream.codec === sub.codec ? 500 : 100;
  if (stream.edition && sub.edition) score += stream.edition === sub.edition ? 1200 : -700;

  const haystack = `${subtitle.name || ""} ${subtitle.downloadLink || ""}`.toLowerCase();
  const tokens = tokenizeFilename(filename);
  score += tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 100 : 0), 0);
  score += Math.min(Number(subtitle.downloads) || 0, 1000) / 10;
  score += Math.min(Number(subtitle.rating) || 0, 10) * 10;
  score += providerReputation(subtitle.provider);
  if (subtitle.is_season_pack) score -= 500;
  return Math.max(0, Math.round(score));
}

function parseReleaseMetadata(filename) {
  const lower = String(filename || "").toLowerCase();
  const groupMatch = lower.match(/-([a-z0-9]+)(?:\.[a-z0-9]+)?$/i);
  const resolutionMatch = lower.match(/\b(2160p|1080p|720p|480p)\b/i);
  const codecMatch = lower.match(/\b(x265|h265|hevc|x264|h264|av1)\b/i);
  const sourceMatch = lower.match(/\b(web-dl|webrip|web|bluray|bdrip|brip|hdtv|dvdrip|cam|ts)\b/i);
  const platformMatch = lower.match(/\b(amzn|amazon|nf|netflix|hulu|dsnp|disney|apple|atvp|hmax|max|peacock|paramount)\b/i);
  const editionMatch = lower.match(/\b(extended|directors?.cut|proper|repack|remux|uncut|theatrical)\b/i);
  return {
    titleBase: lower.split(/\b(2160p|1080p|720p|480p|web-dl|webrip|bluray|hdtv)\b/i)[0],
    group: groupMatch?.[1] || "",
    resolution: resolutionMatch?.[1] || "",
    codec: normalizeCodec(codecMatch?.[1] || ""),
    source: normalizeSource(sourceMatch?.[1] || ""),
    platform: platformMatch?.[1] || "",
    edition: editionMatch?.[1] || ""
  };
}

function tokenizeFilename(filename) {
  return String(filename || "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3 && !/^(mkv|mp4|avi|srt|vtt|ass|ssa)$/.test(token));
}

function normalizeReleaseName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\.(srt|ass|ssa|sub|vtt|idx|sup|mkv|mp4|avi)$/i, "")
    .replace(/^\s*\[[^\]]*\]\s*/g, "")
    .replace(/\s*\[[^\]]*\]\s*$/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCodec(value) {
  const lower = String(value || "").toLowerCase();
  if (["h265", "x265"].includes(lower)) return "hevc";
  if (["h264", "x264"].includes(lower)) return "avc";
  return lower;
}

function normalizeSource(value) {
  const lower = String(value || "").toLowerCase();
  if (lower === "web") return "webrip";
  if (["bdrip", "brip"].includes(lower)) return "bluray";
  return lower;
}

function adjacentSource(a, b) {
  const web = new Set(["web-dl", "webrip"]);
  const disc = new Set(["bluray", "remux"]);
  return (web.has(a) && web.has(b)) || (disc.has(a) && disc.has(b));
}

function providerReputation(provider) {
  return {
    "stremio-community-subtitles": 40,
    "opensubtitles-v3": 35,
    subdl: 30,
    wyzie: 25,
    subsource: 20,
    subsro: 18
  }[provider] || 0;
}

module.exports = {
  deduplicateSubtitles,
  expandRequestedLanguageSet,
  finalizeSubtitleResults,
  normalizeReleaseName,
  parseReleaseMetadata,
  rankAndLimitSubtitles,
  scoreSubtitle
};
