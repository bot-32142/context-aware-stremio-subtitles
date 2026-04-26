const assert = require("node:assert/strict");
const iconv = require("iconv-lite");
const test = require("node:test");
const { parseProviderList } = require("../src/config");
const { detectAndConvertEncoding } = require("../src/encodingDetector");
const { ProviderManager, SubSourceProvider, SubsRoProvider } = require("../src/providers");
const { finalizeSubtitleResults } = require("../src/subtitleRanking");

test("encoding detector uses language hints for legacy subtitle encodings", () => {
  const text = "1\n00:00:01,000 --> 00:00:02,000\n中文測試\n";
  const bytes = iconv.encode(text, "big5");

  const decoded = detectAndConvertEncoding(bytes, "test", "zht");

  assert.match(decoded, /中文測試/);
});

test("provider manager aggregates searches and dispatches downloads by provider", async () => {
  const manager = new ProviderManager({
    config: { dataDir: process.cwd(), providerTimeoutMs: 1000, idResolverTimeoutMs: 1000, subtitleProviders: [] },
    providers: [new FakeProvider("a"), new FailingProvider(), new FakeProvider("b")]
  });

  const results = await manager.search({ imdbId: "tt1", rootId: "tt1" }, ["eng"], {});
  const downloaded = await manager.download("b_1");

  assert.deepEqual(results.map(item => item.fileId), ["a_1", "b_1"]);
  assert.match(downloaded.content, /b subtitle/);
});

test("ranking deduplicates releases and prefers filename matches", () => {
  const ranked = finalizeSubtitleResults([
    { fileId: "slow", languageCode: "eng", name: "Show.S01E01.1080p.BluRay.x264-GRP", provider: "subdl", format: "srt" },
    { fileId: "match", languageCode: "eng", name: "Show.S01E01.1080p.WEB-DL.x265-GRP", provider: "opensubtitles-v3", format: "srt" },
    { fileId: "dupe", languageCode: "eng", name: "Show S01E01 1080p WEB DL x265 GRP", provider: "wyzie", format: "srt" }
  ], ["eng"], { maxSubtitlesPerLanguage: 5, deduplicateSubtitles: true }, {
    filename: "Show.S01E01.1080p.WEB-DL.x265-GRP.mkv"
  });

  assert.equal(ranked[0].fileId, "match");
  assert.deepEqual(ranked.map(item => item.fileId), ["match", "slow"]);
});

test("provider config accepts StremioSubMaker-style optional sources", () => {
  assert.deepEqual(parseProviderList("opensubtitles,scs,subdl,subsource,subsro,wyzie"), [
    "opensubtitles-v3",
    "scs",
    "subdl",
    "subsource",
    "subsro",
    "wyzie"
  ]);
});

test("SubSource filters episode results and keeps season packs", async () => {
  const provider = new SubSourceProvider({ apiKey: "test-key", timeoutMs: 1000 });
  provider.getMovieId = async () => "movie-1";
  provider.client.get = async endpoint => {
    assert.equal(endpoint, "/subtitles");
    return {
      data: {
        subtitles: [
          { subtitleId: "1", language: "english", releaseInfo: ["Show.S01E02.1080p.WEB-DL-GRP"], downloads: 10 },
          { subtitleId: "2", language: "english", releaseInfo: ["Show.S01E03.1080p.WEB-DL-GRP"], downloads: 9 },
          { subtitleId: "3", language: "english", releaseInfo: ["Show.S01.Complete.1080p.WEB-DL-GRP"], downloads: 8 }
        ]
      }
    };
  };

  const results = await provider.search({ imdbId: "tt123", isEpisode: true, season: 1, episode: 2, type: "series" }, ["eng"]);

  assert.deepEqual(results.map(item => item.fileId), ["subsource_1", "subsource_3_seasonpack_s1e2"]);
});

test("SubsRo searches by IMDB id and normalizes provider language codes", async () => {
  const provider = new SubsRoProvider({ apiKey: "test-key", timeoutMs: 1000 });
  provider.client.get = async (endpoint, options) => {
    assert.equal(endpoint, "/search/imdbid/123");
    assert.equal(options.params.language, "en");
    return {
      data: {
        status: 200,
        items: [
          { id: 7, language: "en", description: "Show.S01E02.720p.WEB-DL-GRP", createdAt: "2026-01-01" },
          { id: 8, language: "en", description: "Show.S01E04.720p.WEB-DL-GRP", createdAt: "2026-01-01" }
        ]
      }
    };
  };

  const results = await provider.search({ imdbId: "tt123", isEpisode: true, season: 1, episode: 2, type: "series" }, ["eng"]);

  assert.deepEqual(results.map(item => [item.fileId, item.languageCode]), [["subsro_7", "eng"]]);
});

class FakeProvider {
  constructor(prefix) {
    this.name = prefix;
    this.prefix = prefix;
  }

  canDownload(fileId) {
    return String(fileId).startsWith(`${this.prefix}_`);
  }

  async search() {
    return [{ fileId: `${this.prefix}_1`, languageCode: "eng", name: `${this.prefix} subtitle` }];
  }

  async download() {
    return { content: `1\n00:00:01,000 --> 00:00:02,000\n${this.prefix} subtitle\n`, format: "srt" };
  }
}

class FailingProvider {
  constructor() {
    this.name = "failing";
  }

  canDownload() {
    return false;
  }

  async search() {
    throw new Error("offline");
  }
}
