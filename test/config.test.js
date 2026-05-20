const assert = require("node:assert/strict");
const test = require("node:test");
const { advertisedBaseUrls, loadConfig } = require("../src/config");

test("advertisedBaseUrls prefers configured BASE_URL", () => {
  const urls = advertisedBaseUrls({ baseUrl: "http://example.test:7001/", host: "0.0.0.0", port: 7001 }, {});
  assert.deepEqual(urls, ["http://example.test:7001"]);
});

test("advertisedBaseUrls lists RFC1918 LAN IPv4 addresses for wildcard host", () => {
  const urls = advertisedBaseUrls(
    { baseUrl: "", host: "0.0.0.0", port: 7001 },
    {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      eth0: [
        { address: "10.0.0.31", family: "IPv4", internal: false },
        { address: "100.117.106.19", family: "IPv4", internal: false },
        { address: "192.168.1.50", family: "IPv4", internal: false }
      ]
    }
  );

  assert.deepEqual(urls, ["http://10.0.0.31:7001", "http://192.168.1.50:7001"]);
});

test("translation stays disabled by default until ContextWeave config is present", () => {
  const config = loadConfig({});
  assert.equal(config.translationEnabled, false);
});

test("ContextWeave env vars configure translation", () => {
  const config = loadConfig({
    DATA_DIR: "/tmp/contextweave-config-test",
    CONTEXTWEAVE_CONFIG: "/tmp/contextweave-config-test/contextweave.yaml",
    CONTEXTWEAVE_CLI_CMD: "contextweave-cli --verbose",
    CONTEXTWEAVE_LIBRARY_ROOT: "/tmp/contextweave-config-test/contextweave-library",
    CONTEXTWEAVE_NO_POLISH: "true"
  });

  assert.equal(config.translationEnabled, true);
  assert.equal(config.contextweaveCliCommand, "contextweave-cli --verbose");
  assert.equal(config.contextweaveLibraryRoot, "/tmp/contextweave-config-test/contextweave-library");
  assert.equal(config.contextweaveNoPolish, true);
});

test("legacy CAT env vars are ignored", () => {
  const config = loadConfig({
    DATA_DIR: "/tmp/contextweave-config-test",
    CAT_CONFIG: "/tmp/contextweave-config-test/cat.yaml",
    CAT_CLI_CMD: "cat-cli",
    CAT_LIBRARY_ROOT: "/tmp/contextweave-config-test/legacy-library",
    CAT_NO_POLISH: "true"
  });

  assert.equal(config.translationEnabled, false);
  assert.equal(config.contextweaveConfig, "");
  assert.equal(config.contextweaveCliCommand, "contextweave-cli");
  assert.equal(config.contextweaveLibraryRoot, "/tmp/contextweave-config-test/cat-library");
  assert.equal(config.contextweaveNoPolish, false);
});

test("TARGET_LANGUAGE accepts names and drives one target code", () => {
  const english = loadConfig({ TARGET_LANGUAGE: "English" });
  const traditionalChinese = loadConfig({ TARGET_LANGUAGE: "Traditional Chinese" });

  assert.deepEqual(english.targetLanguages, ["eng"]);
  assert.equal(english.targetLanguageNames.eng, "English");
  assert.deepEqual(traditionalChinese.targetLanguages, ["chi"]);
  assert.equal(traditionalChinese.targetLanguageNames.chi, "Traditional Chinese");
});
