#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getLanguageLabel } = require("../src/languages");

const TARGET_LANGUAGE_TOKEN = "__CONTEXTWEAVE_TARGET_LANGUAGE__";

function resolveContextweaveTargetLanguage(env = process.env) {
  const targetLanguage = String(env.TARGET_LANGUAGE || "").trim();
  if (targetLanguage) return languageNameForInput(targetLanguage);

  const rawFirst = firstRawTargetLanguage(env);
  return languageNameForInput(rawFirst || "chi");
}

function languageNameForInput(value) {
  return getLanguageLabel(String(value || "").trim() || "chi");
}

function firstRawTargetLanguage(env = process.env) {
  return String(env.TARGET_LANGUAGES || "chi")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)[0] || "chi";
}

function targetLanguageCount(env = process.env) {
  if (String(env.TARGET_LANGUAGE || "").trim()) return 1;
  return String(env.TARGET_LANGUAGES || "chi")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean).length || 1;
}

async function renderTemplates(options = {}) {
  const env = options.env || process.env;
  const templateDir = options.templateDir || env.CONTEXTWEAVE_CONFIG_TEMPLATE_DIR || path.join(__dirname, "contextweave-configs", "templates");
  const outputDir = options.outputDir || env.CONTEXTWEAVE_CONFIG_OUTPUT_DIR || path.join(env.DATA_DIR || "/data", "contextweave-configs");
  const logger = options.logger || console;
  const targetLanguage = resolveContextweaveTargetLanguage(env);
  const replacement = quoteYamlString(targetLanguage);

  if (!env.TARGET_LANGUAGE && targetLanguageCount(env) > 1) {
    logger.warn(
      `[contextweave-config] Multiple TARGET_LANGUAGES were provided; built-in ContextWeave configs use the first one (${targetLanguage}).`
    );
  }

  await fs.mkdir(outputDir, { recursive: true });
  const entries = await fs.readdir(templateDir, { withFileTypes: true });
  const rendered = [];

  for (const entry of entries) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const sourcePath = path.join(templateDir, entry.name);
    const outputPath = path.join(outputDir, entry.name);
    const template = await fs.readFile(sourcePath, "utf8");
    const content = template.replaceAll(TARGET_LANGUAGE_TOKEN, replacement);
    await writeFileIfChanged(outputPath, content);
    rendered.push(outputPath);
  }

  if (rendered.length && logger.info) {
    logger.info(`[contextweave-config] Rendered ${rendered.length} ContextWeave config(s) for ${targetLanguage}.`);
  }
  return { targetLanguage, rendered };
}

function quoteYamlString(value) {
  return JSON.stringify(String(value || ""));
}

async function writeFileIfChanged(filePath, content) {
  try {
    const existing = await fs.readFile(filePath, "utf8");
    if (existing === content) return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return true;
}

function runCommand(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { stdio: "inherit", env: process.env });
    let settled = false;

    const forwardSigint = () => {
      if (!settled) child.kill("SIGINT");
    };
    const forwardSigterm = () => {
      if (!settled) child.kill("SIGTERM");
    };
    process.on("SIGINT", forwardSigint);
    process.on("SIGTERM", forwardSigterm);

    child.on("error", error => {
      settled = true;
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
      reject(error);
    });
    child.on("close", (code, signal) => {
      settled = true;
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
      if (signal) {
        resolve(128 + signalToNumber(signal));
        return;
      }
      resolve(code || 0);
    });
  });
}

function signalToNumber(signal) {
  return signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1;
}

async function main() {
  await renderTemplates();
  const command = process.argv.slice(2).filter(arg => arg !== "--render-only");
  if (!command.length) return;
  process.exitCode = await runCommand(command);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  languageNameForInput,
  resolveContextweaveTargetLanguage,
  renderTemplates,
  targetLanguageCount,
  writeFileIfChanged
};
