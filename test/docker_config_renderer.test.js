const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { resolveCatTargetLanguage, renderTemplates } = require("../docker/render-cat-configs");

test("Docker CAT renderer derives target language from TARGET_LANGUAGE", () => {
  assert.equal(resolveCatTargetLanguage({ TARGET_LANGUAGE: "Spanish" }), "Spanish");
  assert.equal(resolveCatTargetLanguage({ TARGET_LANGUAGE: "eng" }), "English");
  assert.equal(resolveCatTargetLanguage({ TARGET_LANGUAGE: "ja" }), "Japanese");
});

test("Docker CAT renderer accepts target language variants", () => {
  assert.equal(resolveCatTargetLanguage({ TARGET_LANGUAGE: "Traditional Chinese" }), "Traditional Chinese");
  assert.equal(resolveCatTargetLanguage({ TARGET_LANGUAGE: "zht" }), "Traditional Chinese");
});

test("Docker CAT renderer writes generated configs without needless rewrites", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-renderer-"));
  const templateDir = path.join(tmp, "templates");
  const outputDir = path.join(tmp, "generated");
  await fs.mkdir(templateDir, { recursive: true });
  await fs.writeFile(
    path.join(templateDir, "profile.yaml"),
    "version: 1\nworkflow_profiles:\n  profile:\n    target_language: __CAT_TARGET_LANGUAGE__\n",
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

  assert.equal(first.targetLanguage, "Korean");
  assert.equal(second.targetLanguage, "Korean");
  assert.match(content, /target_language: "Korean"/);
  assert.deepEqual(first.rendered, [outputPath]);
  assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
});

function silentLogger() {
  return {
    info() {},
    warn() {}
  };
}
