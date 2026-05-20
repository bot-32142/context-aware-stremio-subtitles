const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { sha256 } = require("./hash");

function splitCommand(command) {
  const input = String(command || "").trim();
  if (!input) throw new Error("CONTEXTWEAVE_CLI_CMD is empty.");

  const parts = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (quote) throw new Error("CONTEXTWEAVE_CLI_CMD has an unterminated quote.");
  if (escaping) current += "\\";
  if (current) parts.push(current);
  if (!parts.length) throw new Error("CONTEXTWEAVE_CLI_CMD is empty.");
  return parts;
}

function buildContextweaveCliArgs(options) {
  const args = [];
  if (options.libraryRoot) args.push("--library-root", options.libraryRoot);
  if (options.configPath && !options.bookId) args.push("--config", options.configPath);
  args.push("--json", "run");
  if (options.noPolish) args.push("--no-polish");
  args.push(options.inputPath, "--output", options.outputPath);
  if (options.bookId) {
    args.push("--book-id", options.bookId);
  } else if (options.bookName) {
    args.push("--book-name", options.bookName);
  }
  args.push("--type", "subtitle");
  if (options.format) args.push("--format", options.format);
  return args;
}

async function contextweaveConfigFingerprint(configPath) {
  if (!configPath) return "default";
  try {
    const content = await fs.readFile(configPath);
    return sha256(`${configPath}:sha256:${sha256(content)}`);
  } catch (error) {
    if (error.code === "ENOENT") return sha256(`${configPath}:missing`);
    throw error;
  }
}

class ContextweaveCli {
  constructor({ command, libraryRoot, configPath, noPolish = false, timeoutMs = 60 * 60 * 1000 }) {
    const [bin, ...baseArgs] = splitCommand(command || "contextweave-cli");
    this.bin = bin;
    this.baseArgs = baseArgs;
    this.libraryRoot = libraryRoot;
    this.configPath = configPath;
    this.noPolish = noPolish;
    this.timeoutMs = timeoutMs;
  }

  async run(options) {
    return this._executeJson([
      ...this.baseArgs,
      ...buildContextweaveCliArgs({
        ...options,
        libraryRoot: this.libraryRoot,
        configPath: this.configPath,
        noPolish: options.noPolish ?? this.noPolish
      })
    ]);
  }

  async listBooks() {
    const data = await this._executeJson([...this.baseArgs, ...(this.libraryRoot ? ["--library-root", this.libraryRoot] : []), "--json", "books", "list"]);
    return Array.isArray(data.items) ? data.items : [];
  }

  async _executeJson(args) {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      ({ stdout, stderr } = await spawnCollect(this.bin, args, this.timeoutMs));
    } catch (error) {
      stdout = error.stdout || "";
      stderr = error.stderr || "";
      exitCode = error.exitCode || 1;
      if (!stdout.trim()) throw error;
    }

    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`contextweave-cli returned non-JSON output: ${stdout.slice(0, 500)} ${stderr.slice(0, 500)}`.trim());
    }
    if (!payload.ok) {
      throw buildContextweaveCliError(payload, { exitCode, stderr, stdout });
    }
    return payload.data || {};
  }
}

function buildContextweaveCliError(payload, { exitCode, stderr, stdout }) {
  const details = payload?.error?.details && typeof payload.error.details === "object" ? payload.error.details : {};
  const message = payload?.error?.message || `contextweave-cli exited with ${exitCode}: ${stderr || stdout}`.trim() || "contextweave-cli failed.";
  const error = new Error(message);
  error.details = details;
  error.exitCode = exitCode;
  error.stdout = stdout;
  error.stderr = stderr;

  const bookId = details.book_id || details.project_id || payload?.data?.book_id || payload?.data?.project_id || "";
  if (bookId) error.bookId = String(bookId);

  const projectId = details.project_id || details.book_id || payload?.data?.project_id || payload?.data?.book_id || "";
  if (projectId) error.projectId = String(projectId);

  return error;
}

function spawnCollect(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`contextweave-cli timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
    });
    child.stderr.on("data", chunk => {
      stderr += chunk;
    });
    child.on("error", error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error(`contextweave-cli exited with ${code}: ${stderr || stdout}`.trim());
        error.exitCode = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = {
  ContextweaveCli,
  buildContextweaveCliArgs,
  contextweaveConfigFingerprint,
  splitCommand
};
