function formatMessage(value) {
  const resolved = typeof value === "function" ? value() : value;
  if (Array.isArray(resolved)) return resolved.map(item => (typeof item === "string" ? item : JSON.stringify(item))).join(" ");
  return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
}

function write(level, value) {
  if (process.env.LOG_LEVEL === "silent") return;
  const message = formatMessage(value);
  if (!message) return;
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  logger(`[${level}] ${message}`);
}

module.exports = {
  debug: value => {
    if (process.env.LOG_LEVEL === "debug") write("debug", value);
  },
  info: value => write("info", value),
  warn: value => write("warn", value),
  error: value => write("error", value)
};
