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

test("translation stays disabled by default until CAT config is present", () => {
  const config = loadConfig({});
  assert.equal(config.translationEnabled, false);
});

test("TARGET_LANGUAGE accepts names and drives one target code", () => {
  const english = loadConfig({ TARGET_LANGUAGE: "English" });
  const traditionalChinese = loadConfig({ TARGET_LANGUAGE: "Traditional Chinese" });

  assert.deepEqual(english.targetLanguages, ["eng"]);
  assert.equal(english.targetLanguageNames.eng, "English");
  assert.deepEqual(traditionalChinese.targetLanguages, ["chi"]);
  assert.equal(traditionalChinese.targetLanguageNames.chi, "Traditional Chinese");
});
