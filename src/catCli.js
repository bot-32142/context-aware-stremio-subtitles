const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { sha256 } = require("./hash");

function splitCommand(command) {
  const input = String(command || "").trim();
  if (!input) throw new Error("CAT_CLI_CMD is empty.");

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

  if (quote) throw new Error("CAT_CLI_CMD has an unterminated quote.");
  if (escaping) current += "\\";
  if (current) parts.push(current);
  if (!parts.length) throw new Error("CAT_CLI_CMD is empty.");
  return parts;
}

function buildCatCliArgs(options) {
  const args = [];
  if (options.libraryRoot) args.push("--library-root", options.libraryRoot);
  if (options.configPath && !options.bookId) args.push("--config", options.configPath);
  args.push("--json", "run", options.inputPath, "--output", options.outputPath);
  if (options.bookId) {
    args.push("--book-id", options.bookId);
  } else if (options.bookName) {
    args.push("--book-name", options.bookName);
  }
  args.push("--type", "subtitle");
  if (options.format) args.push("--format", options.format);
  return args;
}

async function catConfigFingerprint(configPath) {
  if (!configPath) return "default";
  try {
    const stat = await fs.stat(configPath);
    return sha256(`${configPath}:${stat.size}:${stat.mtimeMs}`);
  } catch (error) {
    if (error.code === "ENOENT") return sha256(`${configPath}:missing`);
    throw error;
  }
}

class CatCli {
  constructor({ command, libraryRoot, configPath, timeoutMs = 60 * 60 * 1000 }) {
    const [bin, ...baseArgs] = splitCommand(command || "cat-cli");
    this.bin = bin;
    this.baseArgs = baseArgs;
    this.libraryRoot = libraryRoot;
    this.configPath = configPath;
    this.timeoutMs = timeoutMs;
  }

  async run(options) {
    const args = [
      ...this.baseArgs,
      ...buildCatCliArgs({
        ...options,
        libraryRoot: this.libraryRoot,
        configPath: this.configPath
      })
    ];

    const { stdout, stderr } = await spawnCollect(this.bin, args, this.timeoutMs);
    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch (error) {
      throw new Error(`cat-cli returned non-JSON output: ${stdout.slice(0, 500)} ${stderr.slice(0, 500)}`.trim());
    }
    if (!payload.ok) {
      const message = payload.error?.message || "cat-cli failed.";
      throw new Error(message);
    }
    return payload.data || {};
  }
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
      reject(new Error(`cat-cli timed out after ${timeoutMs}ms.`));
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
        reject(new Error(`cat-cli exited with ${code}: ${stderr || stdout}`.trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = {
  CatCli,
  buildCatCliArgs,
  catConfigFingerprint,
  splitCommand
};
