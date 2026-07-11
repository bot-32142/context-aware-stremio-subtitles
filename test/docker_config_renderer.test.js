const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveContextweaveTargetLanguage, renderTemplates } = require("../docker/render-contextweave-configs");

test("Docker ContextWeave renderer derives target language from TARGET_LANGUAGE", () => {
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "Spanish" }), "Español");
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "eng" }), "English");
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "ja" }), "日本語");
});

test("Docker ContextWeave renderer accepts target language variants", () => {
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "Traditional Chinese" }), "中文（繁體）");
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "zht" }), "中文（繁體）");
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "chi" }), "中文（简体）");
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "中文（繁體）" }), "中文（繁體）");
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "Español" }), "Español");
  assert.equal(resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "sw" }), "Kiswahili");
});

test("Docker ContextWeave renderer rejects unsupported target presets", () => {
  assert.throws(
    () => resolveContextweaveTargetLanguage({ TARGET_LANGUAGE: "Catalan" }),
    /not supported by ContextWeave/
  );
});

test("Docker ContextWeave renderer writes generated configs without needless rewrites", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-renderer-"));
  const templateDir = path.join(tmp, "templates");
  const outputDir = path.join(tmp, "generated");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.writeFile(
    path.join(templateDir, "profile.yaml"),
    "version: 1\nworkflow_profiles:\n  profile:\n    target_language: __CONTEXTWEAVE_TARGET_LANGUAGE__\n",
    "utf8"
  );

  const first = await renderTemplates({
    templateDir,
    outputDir,
    env: { TARGET_LANGUAGE: "Korean" },
    logger: silentLogger()
  });
  const outputPath = path.join(outputDir, "profile.yaml");
  const content = await fs.readFile(outputPath, "utf8");
  const firstStat = await fs.stat(outputPath);

  await new Promise(resolve => setTimeout(resolve, 5));
  const second = await renderTemplates({
    templateDir,
    outputDir,
    env: { TARGET_LANGUAGE: "Korean" },
    logger: silentLogger()
  });
  const secondStat = await fs.stat(outputPath);

  assert.equal(first.targetLanguage, "한국어");
  assert.equal(second.targetLanguage, "한국어");
  assert.match(content, /target_language: "한국어"/);
  assert.deepEqual(first.rendered, [outputPath]);
  assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
});

function silentLogger() {
  return {
    info() {},
    warn() {}
  };
}
