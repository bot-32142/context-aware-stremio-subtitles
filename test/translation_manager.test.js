const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BookRegistry } = require("../src/bookRegistry");
const { CatCli } = require("../src/catCli");
const { loadConfig } = require("../src/config");
const { mediaContextKey, parseStremioId } = require("../src/media");
const { TranslationManager } = require("../src/translationManager");

test("translation manager stores returned book_id and reuses it with --book-id", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-"));
  const fakeCliPath = path.join(tmp, "fake-cat-cli.js");
  const callsPath = path.join(tmp, "calls.json");
  const catConfigPath = path.join(tmp, "cat.yaml");
  await fs.writeFile(catConfigPath, "version: 1\n", "utf8");
  await fs.writeFile(fakeCliPath, fakeCliScript(), "utf8");
  process.env.FAKE_CAT_CALLS = callsPath;

  const config = loadConfig({
    DATA_DIR: tmp,
    CAT_CONFIG: catConfigPath,
    CAT_CLI_CMD: `node ${fakeCliPath}`,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const provider = new FakeProvider({
    source1: makeSrt("Hello."),
    source2: makeSrt("Goodbye.")
  });
  const registry = new BookRegistry(path.join(tmp, "book-registry.json"));
  const catCli = new CatCli({
    command: config.catCliCommand,
    libraryRoot: config.catLibraryRoot,
    configPath: config.catConfig
  });
  const manager = new TranslationManager({ config, provider, registry, catCli });
  const mediaInfo = parseStremioId("series", "tt0944947:1:1");

  const first = await manager.requestTranslation({
    sourceFileId: "source1",
    targetLanguage: "chi",
    mediaInfo,
    filename: "show.s01e01.mkv"
  });
  assert.equal(first.state, "loading");
  await manager.waitForAll();

  const registryKey = mediaContextKey(mediaInfo, "chi");
  assert.equal((await registry.get(registryKey)).bookId, "book-created-1");

  const secondMediaInfo = parseStremioId("series", "tt0944947:2:4");
  const second = await manager.requestTranslation({
    sourceFileId: "source2",
    targetLanguage: "chi",
    mediaInfo: secondMediaInfo,
    filename: "show.s02e04.mkv"
  });
  assert.equal(second.state, "loading");
  await manager.waitForAll();

  const calls = JSON.parse(await fs.readFile(callsPath, "utf8"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes("--book-name"), true);
  assert.equal(calls[0].includes("--config"), true);
  assert.equal(calls[0].includes("--book-id"), false);
  assert.equal(calls[1].includes("--book-id"), true);
  assert.equal(calls[1][calls[1].indexOf("--book-id") + 1], "book-created-1");
  assert.equal(calls[1].includes("--config"), false);
});

test("translation manager serves request cache without redownloading source", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-cache-"));
  const catConfigPath = path.join(tmp, "cat.yaml");
  await fs.writeFile(catConfigPath, "version: 1\n", "utf8");
  const config = loadConfig({
    DATA_DIR: tmp,
    CAT_CONFIG: catConfigPath,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const provider = new CountingProvider({ source1: makeSrt("Hello.") });
  const manager = new TranslationManager({
    config,
    provider,
    registry: new BookRegistry(path.join(tmp, "book-registry.json")),
    catCli: new MemoryCatCli()
  });
  const mediaInfo = parseStremioId("series", "tt0944947:1:1");

  assert.equal((await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo })).state, "loading");
  await manager.waitForAll();
  provider.failDownloads = true;

  const cached = await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo });

  assert.equal(cached.state, "complete");
  assert.match(cached.content, /Translated/);
  assert.equal(provider.downloadCount, 1);
});

test("translation manager does not store cat-cli failures as final cache", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-fail-"));
  const catConfigPath = path.join(tmp, "cat.yaml");
  await fs.writeFile(catConfigPath, "version: 1\n", "utf8");
  const config = loadConfig({
    DATA_DIR: tmp,
    CAT_CONFIG: catConfigPath,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const catCli = new FlakyCatCli();
  const manager = new TranslationManager({
    config,
    provider: new CountingProvider({ source1: makeSrt("Hello.") }),
    registry: new BookRegistry(path.join(tmp, "book-registry.json")),
    catCli
  });
  const mediaInfo = parseStremioId("series", "tt0944947:1:1");

  assert.equal((await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo })).state, "loading");
  await manager.waitForAll();
  const error = await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo });
  assert.equal(error.state, "error");

  const retry = await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo });
  assert.equal(retry.state, "loading");
  await manager.waitForAll();
  assert.equal(catCli.calls, 2);
});

class FakeProvider {
  constructor(sources) {
    this.sources = sources;
  }

  async download(fileId) {
    return {
      content: this.sources[fileId],
      format: "srt"
    };
  }
}

class CountingProvider extends FakeProvider {
  constructor(sources) {
    super(sources);
    this.downloadCount = 0;
    this.failDownloads = false;
  }

  async download(fileId) {
    this.downloadCount += 1;
    if (this.failDownloads) throw new Error("provider unavailable");
    return super.download(fileId);
  }
}

class MemoryCatCli {
  async run(options) {
    await fs.writeFile(options.outputPath, makeSrt("Translated."), "utf8");
    return { book_id: options.bookId || "memory-book" };
  }
}

class FlakyCatCli {
  constructor() {
    this.calls = 0;
  }

  async run(options) {
    this.calls += 1;
    if (this.calls === 1) throw new Error("temporary CAT failure");
    await fs.writeFile(options.outputPath, makeSrt("Translated after retry."), "utf8");
    return { book_id: options.bookId || "flaky-book" };
  }
}

function makeSrt(line) {
  return `1
00:00:01,000 --> 00:00:02,000
${line}
`;
}

function fakeCliScript() {
  return `
const fs = require("node:fs");
const args = process.argv.slice(2);
const callsPath = process.env.FAKE_CAT_CALLS;
const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf8")) : [];
calls.push(args);
fs.writeFileSync(callsPath, JSON.stringify(calls, null, 2));

const outputPath = args[args.indexOf("--output") + 1];
const bookIdIndex = args.indexOf("--book-id");
const bookId = bookIdIndex >= 0 ? args[bookIdIndex + 1] : "book-created-1";
fs.writeFileSync(outputPath, "1\\n00:00:01,000 --> 00:00:02,000\\nTranslated with " + bookId + "\\n", "utf8");

console.log(JSON.stringify({
  ok: true,
  command: "run",
  data: {
    book_id: bookId,
    project_id: bookId,
    document_id: calls.length,
    task_id: "task-" + calls.length,
    status: "completed",
    output_path: outputPath
  },
  warnings: []
}));
`;
}
