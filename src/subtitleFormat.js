function detectSubtitleFormat(content, fallback = "srt") {
  const text = String(content || "");
  const trimmed = text.trimStart();
  if (/^WEBVTT\b/i.test(trimmed)) return "vtt";
  if (/\[Script Info\]/i.test(text) || /\[Events\]/i.test(text) || /^Dialogue:/im.test(text)) {
    if (/ScriptType:\s*v4\.00(?!\+)/i.test(text)) return "ssa";
    return "ass";
  }
  if (/^\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->/m.test(trimmed)) return "srt";
  return normalizeSubtitleFormat(fallback);
}

function inferFormatFromName(name, fallback = "srt") {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)(?:$|[?#])/);
  if (!match) return normalizeSubtitleFormat(fallback);
  return normalizeSubtitleFormat(match[1]);
}

function normalizeSubtitleFormat(value) {
  const format = String(value || "").toLowerCase().replace(/^\./, "");
  if (["srt", "vtt", "ass", "ssa"].includes(format)) return format;
  return "srt";
}

function contentTypeForFormat(format) {
  const normalized = normalizeSubtitleFormat(format);
  if (normalized === "vtt") return "text/vtt; charset=utf-8";
  if (normalized === "ass" || normalized === "ssa") return "text/x-ssa; charset=utf-8";
  return "text/plain; charset=utf-8";
}

module.exports = {
  contentTypeForFormat,
  detectSubtitleFormat,
  inferFormatFromName,
  normalizeSubtitleFormat
};
