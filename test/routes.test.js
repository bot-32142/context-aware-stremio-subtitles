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
  } finally {
    await close();
  }
});

test("subtitle route includes direct subtitles and Make entries", async () => {
  const { baseUrl, close } = await serveTestApp();
  try {
    const response = await fetch(`${baseUrl}/subtitles/series/tt0944947:1:1.json?filename=show.s01e01.mkv`);
    const payload = await response.json();
    const labels = payload.subtitles.map(item => item.lang);

    assert.equal(labels.includes("eng"), true);
    assert.equal(labels.includes("Make Chinese"), true);
    assert.equal(payload.subtitles.some(item => item.url.includes("/translate/source1/chi")), true);
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
  const { baseUrl, close } = await serveTestApp({ translationManager: manager });
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

async function serveTestApp(overrides = {}) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-routes-"));
  const config = loadConfig({
    DATA_DIR: tmp,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
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
