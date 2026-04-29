const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");

test("manifest route returns a Stremio subtitle addon manifest", async () => {
  const { baseUrl, close } = await serveTestApp();
  try {
    const response = await fetch(`${baseUrl}/manifest.json`);
    const manifest = await response.json();

    assert.equal(manifest.resources.includes("subtitles"), true);
    assert.equal(manifest.types.includes("series"), true);
    assert.match(manifest.description, /Translation is disabled/);
  } finally {
    await close();
  }
});

test("root route redirects to the manifest for Stremio compatibility", async () => {
  const { baseUrl, close } = await serveTestApp();
  try {
    const response = await fetch(`${baseUrl}/`, { redirect: "manual" });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/manifest.json");
  } finally {
    await close();
  }
});

test("help route prints the manifest URL for quick install", async () => {
  const { baseUrl, close } = await serveTestApp();
  try {
    const response = await fetch(`${baseUrl}/help`);
    const body = await response.text();

    assert.match(body, /Manifest: http:\/\/127\.0\.0\.1:\d+\/manifest\.json/);
  } finally {
    await close();
  }
});

test("manifest route includes permissive CORS headers", async () => {
  const { baseUrl, close } = await serveTestApp();
  try {
    const response = await fetch(`${baseUrl}/manifest.json`);

    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.match(response.headers.get("cache-control") || "", /no-store/);
  } finally {
    await close();
  }
});

test("subtitle route returns only translated entries when translation is enabled", async () => {
  const { baseUrl, close } = await serveTestApp({ env: { ENABLE_TRANSLATION: "true" } });
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json?filename=show.s01e01.mkv`);
    const payload = await response.json();
    const labels = payload.subtitles.map(item => item.lang);

    assert.equal(labels.includes("eng"), false);
    assert.equal(labels.every(label => label === "chi"), true);
    assert.equal(payload.subtitles.some(item => item.url.includes("/translate/source1/chi")), true);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
  } finally {
    await close();
  }
});

test("subtitle route uses ISO codes for translated entries", async () => {
  const { baseUrl, close } = await serveTestApp({ env: { ENABLE_TRANSLATION: "true", TARGET_LANGUAGE: "Spanish" } });
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json?filename=show.s01e01.mkv`);
    const payload = await response.json();

    assert.equal(payload.subtitles.some(item => item.lang === "spa"), true);
    assert.equal(payload.subtitles.some(item => item.url.includes("/translate/source1/spa")), true);
  } finally {
    await close();
  }
});

test("subtitle route accepts English as a single target language", async () => {
  const { baseUrl, close } = await serveTestApp({ env: { ENABLE_TRANSLATION: "true", TARGET_LANGUAGE: "English" } });
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json?filename=show.s01e01.mkv`);
    const payload = await response.json();

    assert.equal(payload.subtitles.some(item => item.lang === "eng"), true);
    assert.equal(payload.subtitles.some(item => item.url.includes("/translate/source1/eng")), true);
  } finally {
    await close();
  }
});

test("subtitle route preserves target language display variants", async () => {
  const { baseUrl, close } = await serveTestApp({
    env: { ENABLE_TRANSLATION: "true", TARGET_LANGUAGE: "Traditional Chinese" }
  });
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json?filename=show.s01e01.mkv`);
    const payload = await response.json();

    assert.equal(payload.subtitles.some(item => item.lang === "chi"), true);
    assert.equal(payload.subtitles.some(item => item.url.includes("/translate/source1/chi")), true);
  } finally {
    await close();
  }
});

test("subtitle route omits Make entries when translation is disabled", async () => {
  const { baseUrl, close } = await serveTestApp();
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json?filename=show.s01e01.mkv`);
    const payload = await response.json();

    assert.equal(payload.subtitles.some(item => item.url.includes("/translate/")), false);
    assert.equal(payload.subtitles.some(item => item.lang === "eng"), true);
  } finally {
    await close();
  }
});

test("subtitle route returns an empty list when provider search fails", async () => {
  const { baseUrl, close } = await serveTestApp({ provider: new FailingSearchProvider() });
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { subtitles: [] });
  } finally {
    await close();
  }
});

test("subtitle route filters undetermined language entries out of the response", async () => {
  const { baseUrl, close } = await serveTestApp({ provider: new UnknownLanguageProvider(), env: { ENABLE_TRANSLATION: "true" } });
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json?filename=show.s01e01.mkv`);
    const payload = await response.json();

    assert.equal(payload.subtitles.some(item => item.lang === "und" || item.lang === "unknown(und)"), false);
    assert.equal(payload.subtitles.some(item => item.lang === "chi"), true);
  } finally {
    await close();
  }
});

test("subtitle route returns an empty list instead of throwing on malformed provider results", async () => {
  const { baseUrl, close } = await serveTestApp({ provider: new MalformedResultProvider() });
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(payload, { subtitles: [] });
  } finally {
    await close();
  }
});

test("download route serves provider subtitle content", async () => {
  const { baseUrl, close } = await serveTestApp();
  try {
    const response = await fetch(`${baseUrl}/subtitle/source1/eng`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Hello/);
  } finally {
    await close();
  }
});

test("translate route returns loading then final cached subtitle", async () => {
  const manager = new StubTranslationManager();
  const { baseUrl, close } = await serveTestApp({ translationManager: manager, env: { ENABLE_TRANSLATION: "true" } });
  try {
    const url = `${baseUrl}/translate/source1/chi?type=series&id=tt0944947:1:1&filename=show.s01e01.mkv`;
    const first = await fetch(url);
    const firstBody = await first.text();
    assert.match(firstBody, /Translation is running/);

    const second = await fetch(url);
    const secondBody = await second.text();
    assert.match(secondBody, /Final translation/);
  } finally {
    await close();
  }
});

test("translate route rejects requests when translation is disabled", async () => {
  const { baseUrl, close } = await serveTestApp();
  try {
    const response = await fetch(`${baseUrl}/translate/source1/chi?type=series&id=tt0944947:1:1`);
    const body = await response.text();

    assert.equal(response.status, 503);
    assert.match(body, /Translation is disabled/);
  } finally {
    await close();
  }
});

async function serveTestApp(overrides = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-routes-"));
  const config = loadConfig({
    DATA_DIR: tmp,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi",
    ...overrides.env
  });
  const app = createApp({
    config,
    provider: overrides.provider || new StubProvider(),
    translationManager: overrides.translationManager
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

class StubProvider {
  async search() {
    return [
      { fileId: "source1", languageCode: "eng", name: "show s01e01 english" },
      { fileId: "target1", languageCode: "chi", name: "show s01e01 chinese" }
    ];
  }

  async download(fileId) {
    return {
      content: fileId === "source1" ? "1\n00:00:01,000 --> 00:00:02,000\nHello\n" : "1\n00:00:01,000 --> 00:00:02,000\n你好\n",
      format: "srt"
    };
  }
}

class FailingSearchProvider extends StubProvider {
  async search() {
    throw new Error("provider down");
  }
}

class UnknownLanguageProvider extends StubProvider {
  async search() {
    return [
      { fileId: "unknown1", languageCode: "und", language: "und", name: "show s01e01 mystery" },
      { fileId: "source1", languageCode: "eng", name: "show s01e01 english" }
    ];
  }
}

class MalformedResultProvider extends StubProvider {
  async search() {
    return [
      {
        get languageCode() {
          throw new Error("broken subtitle payload");
        },
        fileId: "broken1"
      }
    ];
  }
}

class StubTranslationManager {
  constructor() {
    this.calls = 0;
  }

  async requestTranslation() {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        state: "loading",
        format: "srt",
        content: "1\n00:00:00,000 --> 04:00:00,000\nTranslation is running in the background.\n"
      };
    }
    return {
      state: "complete",
      format: "srt",
      content: "1\n00:00:01,000 --> 00:00:02,000\nFinal translation\n"
    };
  }
}
