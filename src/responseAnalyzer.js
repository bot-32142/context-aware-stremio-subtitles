function analyzeResponseContent(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  if (!bytes.length) return { type: "empty", hint: "empty response" };

  const preview = bytes.subarray(0, Math.min(bytes.length, 512)).toString("utf8").trimStart();
  if (/^<!doctype html/i.test(preview) || /^<html[\s>]/i.test(preview)) {
    return { type: "html_error", hint: "HTML page instead of subtitle" };
  }
  if (/^\{/.test(preview)) {
    try {
      const payload = JSON.parse(preview);
      if (payload.error || payload.message) return { type: "json_error", hint: payload.error || payload.message };
    } catch (_error) {
      return { type: "json_error", hint: "JSON response instead of subtitle" };
    }
  }
  if (/cloudflare|access denied|not found|forbidden|too many requests/i.test(preview) && !looksLikeSubtitle(preview)) {
    return { type: "text_error", hint: preview.slice(0, 120) };
  }
  return { type: looksLikeSubtitle(preview) ? "subtitle" : "unknown", hint: "" };
}

function looksLikeSubtitle(text) {
  const value = String(text || "").trimStart();
  return (
    value.startsWith("WEBVTT") ||
    /^\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.:]\d{2,3}/.test(value) ||
    /\[script info\]|\[events\]|^dialogue\s*:/im.test(value)
  );
}

module.exports = {
  analyzeResponseContent,
  looksLikeSubtitle
};
