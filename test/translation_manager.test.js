const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BookRegistry } = require("../src/bookRegistry");
const { ContextweaveCli } = require("../src/contextweaveCli");
const { loadConfig } = require("../src/config");
const { mediaContextKey, parseStremioId } = require("../src/media");
const { TranslationManager } = require("../src/translationManager");

test("translation manager stores returned book_id and reuses it with --book-id", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-"));
  const fakeCliPath = path.join(tmp, "fake-contextweave-cli.js");
  const callsPath = path.join(tmp, "calls.json");
  const contextweaveConfigPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(contextweaveConfigPath, "version: 1\n", "utf8");
  await fs.writeFile(fakeCliPath, fakeCliScript(), "utf8");
  process.env.FAKE_CONTEXTWEAVE_CALLS = callsPath;

  const config = loadConfig({
    DATA_DIR: tmp,
    CONTEXTWEAVE_CONFIG: contextweaveConfigPath,
    CONTEXTWEAVE_CLI_CMD: `node ${fakeCliPath}`,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const provider = new FakeProvider({
    source1: makeSrt("Hello."),
    source2: makeSrt("Goodbye.")
  });
  const registry = new BookRegistry(path.join(tmp, "book-registry.json"));
  const contextweaveCli = new ContextweaveCli({
    command: config.contextweaveCliCommand,
    libraryRoot: config.contextweaveLibraryRoot,
    configPath: config.contextweaveConfig
  });
  const manager = new TranslationManager({ config, provider, registry, contextweaveCli });
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
  const runCalls = calls.filter(args => args.includes("run"));
  assert.equal(runCalls.length, 2);
  assert.equal(runCalls[0].includes("--book-name"), true);
  assert.equal(runCalls[0].includes("--config"), true);
  assert.equal(runCalls[0].includes("--book-id"), false);
  assert.equal(runCalls[1].includes("--book-id"), true);
  assert.equal(runCalls[1][runCalls[1].indexOf("--book-id") + 1], "book-created-1");
  assert.equal(runCalls[1].includes("--config"), false);
});

test("translation manager serves request cache without redownloading source", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-cache-"));
  const contextweaveConfigPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(contextweaveConfigPath, "version: 1\n", "utf8");
  const config = loadConfig({
    DATA_DIR: tmp,
    CONTEXTWEAVE_CONFIG: contextweaveConfigPath,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const provider = new CountingProvider({ source1: makeSrt("Hello.") });
  const manager = new TranslationManager({
    config,
    provider,
    registry: new BookRegistry(path.join(tmp, "book-registry.json")),
    contextweaveCli: new MemoryContextweaveCli()
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

test("translation manager keeps one canonical translation per episode and target language", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-episode-key-"));
  const contextweaveConfigPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(contextweaveConfigPath, "version: 1\n", "utf8");
  const config = loadConfig({
    DATA_DIR: tmp,
    CONTEXTWEAVE_CONFIG: contextweaveConfigPath,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const provider = new CountingProvider({ source1: makeSrt("Hello."), source2: makeSrt("Different source text.") });
  const contextweaveCli = new CountingMemoryContextweaveCli();
  const manager = new TranslationManager({
    config,
    provider,
    registry: new BookRegistry(path.join(tmp, "book-registry.json")),
    contextweaveCli
  });
  const mediaInfo = parseStremioId("series", "tt0944947:1:1");

  assert.equal((await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo })).state, "loading");
  await manager.waitForAll();
  assert.equal(contextweaveCli.calls, 1);

  const cached = await manager.requestTranslation({ sourceFileId: "source2", targetLanguage: "chi", mediaInfo });
  assert.equal(cached.state, "complete");
  assert.match(cached.content, /Translated/);
  assert.equal(contextweaveCli.calls, 1);
});

test("translation manager reuses cached translation immediately for the same episode even if provider file id changes", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-source-hash-"));
  const contextweaveConfigPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(contextweaveConfigPath, "version: 1\n", "utf8");
  const config = loadConfig({
    DATA_DIR: tmp,
    CONTEXTWEAVE_CONFIG: contextweaveConfigPath,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const firstContextweaveCli = new CountingMemoryContextweaveCli();
  const firstManager = new TranslationManager({
    config,
    provider: new CountingProvider({ source1: makeSrt("Hello.") }),
    registry: new BookRegistry(path.join(tmp, "book-registry.json")),
    contextweaveCli: firstContextweaveCli
  });
  const mediaInfo = parseStremioId("series", "tt0944947:1:1");

  assert.equal((await firstManager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo })).state, "loading");
  await firstManager.waitForAll();
  assert.equal(firstContextweaveCli.calls, 1);

  const secondContextweaveCli = new CountingMemoryContextweaveCli();
  const secondProvider = new CountingProvider({ source2: makeSrt("Hello.") });
  const secondManager = new TranslationManager({
    config,
    provider: secondProvider,
    registry: new BookRegistry(path.join(tmp, "book-registry.json")),
    contextweaveCli: secondContextweaveCli
  });

  const cached = await secondManager.requestTranslation({ sourceFileId: "source2", targetLanguage: "chi", mediaInfo });
  assert.equal(cached.state, "complete");
  assert.match(cached.content, /Translated/);
  assert.equal(secondProvider.downloadCount, 0);
  assert.equal(secondContextweaveCli.calls, 0);
});

test("translation manager does not store contextweave-cli failures as final cache", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-fail-"));
  const contextweaveConfigPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(contextweaveConfigPath, "version: 1\n", "utf8");
  const config = loadConfig({
    DATA_DIR: tmp,
    CONTEXTWEAVE_CONFIG: contextweaveConfigPath,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const contextweaveCli = new FlakyContextweaveCli();
  const manager = new TranslationManager({
    config,
    provider: new CountingProvider({ source1: makeSrt("Hello.") }),
    registry: new BookRegistry(path.join(tmp, "book-registry.json")),
    contextweaveCli
  });
  const mediaInfo = parseStremioId("series", "tt0944947:1:1");

  assert.equal((await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo })).state, "loading");
  await manager.waitForAll();
  const error = await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo });
  assert.equal(error.state, "error");

  const retry = await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo });
  assert.equal(retry.state, "loading");
  await manager.waitForAll();
  assert.equal(contextweaveCli.calls, 2);
});

test("translation manager recovers an existing ContextWeave book when addon registry is empty", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-recover-"));
  const contextweaveConfigPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(contextweaveConfigPath, "version: 1\n", "utf8");
  const config = loadConfig({
    DATA_DIR: tmp,
    CONTEXTWEAVE_CONFIG: contextweaveConfigPath,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const provider = new FakeProvider({ source1: makeSrt("Hello.") });
  const registry = new BookRegistry(path.join(tmp, "book-registry.json"));
  const contextweaveCli = new RecoveringContextweaveCli();
  const manager = new TranslationManager({ config, provider, registry, contextweaveCli });
  const mediaInfo = parseStremioId("series", "tt14596630:1:1");

  assert.equal((await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo })).state, "loading");
  await manager.waitForAll();

  assert.equal(contextweaveCli.calls.length, 1);
  assert.equal(contextweaveCli.calls[0].bookId, "series-tt14596630-chi-finished");
  assert.equal(contextweaveCli.calls[0].bookName, "");
  assert.equal((await registry.get(mediaContextKey(mediaInfo, "chi"))).bookId, "series-tt14596630-chi-finished");
});

test("translation manager does not recover a book with a legacy target language", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "contextweave-manager-legacy-book-"));
  const contextweaveConfigPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(contextweaveConfigPath, "version: 1\n", "utf8");
  const config = loadConfig({
    DATA_DIR: tmp,
    CONTEXTWEAVE_CONFIG: contextweaveConfigPath,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const contextweaveCli = new LegacyRecoveringContextweaveCli();
  const manager = new TranslationManager({
    config,
    provider: new FakeProvider({ source1: makeSrt("Hello.") }),
    registry: new BookRegistry(path.join(tmp, "book-registry.json")),
    contextweaveCli
  });
  const mediaInfo = parseStremioId("series", "tt14596630:1:1");

  assert.equal((await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo })).state, "loading");
  await manager.waitForAll();

  assert.equal(contextweaveCli.calls.length, 1);
  assert.equal(contextweaveCli.calls[0].bookId, "");
  assert.equal(contextweaveCli.calls[0].bookName, "Series tt14596630 -> chi");
});

test("translation manager remembers book_id from failed ContextWeave runs and reuses it on retry", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-manager-failed-book-"));
  const fakeCliPath = path.join(tmp, "failing-contextweave-cli.js");
  const callsPath = path.join(tmp, "calls.json");
  const contextweaveConfigPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(contextweaveConfigPath, "version: 1\n", "utf8");
  await fs.writeFile(fakeCliPath, failingCliScript(), "utf8");
  process.env.FAKE_CONTEXTWEAVE_CALLS = callsPath;

  const config = loadConfig({
    DATA_DIR: tmp,
    CONTEXTWEAVE_CONFIG: contextweaveConfigPath,
    CONTEXTWEAVE_CLI_CMD: `node ${fakeCliPath}`,
    SOURCE_LANGUAGES: "eng",
    TARGET_LANGUAGES: "chi"
  });
  const provider = new FakeProvider({
    source1: makeSrt("Hello."),
    source2: makeSrt("Goodbye.")
  });
  const registry = new BookRegistry(path.join(tmp, "book-registry.json"));
  const contextweaveCli = new ContextweaveCli({
    command: config.contextweaveCliCommand,
    libraryRoot: config.contextweaveLibraryRoot,
    configPath: config.contextweaveConfig
  });
  const manager = new TranslationManager({ config, provider, registry, contextweaveCli });
  const mediaInfo = parseStremioId("series", "tt0944947:1:1");

  assert.equal((await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo })).state, "loading");
  await manager.waitForAll();
  assert.equal((await registry.get(mediaContextKey(mediaInfo, "chi"))).bookId, "book-created-on-failure");

  const error = await manager.requestTranslation({ sourceFileId: "source1", targetLanguage: "chi", mediaInfo });
  assert.equal(error.state, "error");

  const secondMediaInfo = parseStremioId("series", "tt0944947:2:4");
  assert.equal(
    (await manager.requestTranslation({ sourceFileId: "source2", targetLanguage: "chi", mediaInfo: secondMediaInfo })).state,
    "loading"
  );
  await manager.waitForAll();

  const calls = JSON.parse(await fs.readFile(callsPath, "utf8"));
  const runCalls = calls.filter(args => args.includes("run"));
  assert.equal(runCalls.length, 2);
  assert.equal(runCalls[0].includes("--book-name"), true);
  assert.equal(runCalls[0].includes("--book-id"), false);
  assert.equal(runCalls[1].includes("--book-id"), true);
  assert.equal(runCalls[1][runCalls[1].indexOf("--book-id") + 1], "book-created-on-failure");
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

class MemoryContextweaveCli {
  async run(options) {
    await fs.writeFile(options.outputPath, makeSrt("Translated."), "utf8");
    return { book_id: options.bookId || "memory-book" };
  }
}

class CountingMemoryContextweaveCli extends MemoryContextweaveCli {
  constructor() {
    super();
    this.calls = 0;
  }

  async run(options) {
    this.calls += 1;
    return super.run(options);
  }
}

class FlakyContextweaveCli {
  constructor() {
    this.calls = 0;
  }

  async run(options) {
    this.calls += 1;
    if (this.calls === 1) throw new Error("temporary ContextWeave failure");
    await fs.writeFile(options.outputPath, makeSrt("Translated after retry."), "utf8");
    return { book_id: options.bookId || "flaky-book" };
  }
}

class RecoveringContextweaveCli extends MemoryContextweaveCli {
  constructor() {
    super();
    this.calls = [];
  }

  async listBooks() {
    return [
      {
        project: {
          project_id: "series-tt14596630-chi-finished",
          name: "Series tt14596630 -> chi"
        },
        target_language: "中文（简体）",
        progress_summary: "10/10 translated",
        modified_at: 200
      },
      {
        project: {
          project_id: "series-tt14596630-alt",
          name: "Series tt14596630 (NVUJDEZU6IUUOD02) -> chi"
        },
        target_language: "中文（简体）",
        progress_summary: "10/10 translated",
        modified_at: 300
      },
      {
        project: {
          project_id: "movie-tt0111161-chi-finished",
          name: "Movie tt0111161 -> chi"
        },
        target_language: "中文（简体）",
        progress_summary: "100/100 translated",
        modified_at: 500
      }
    ];
  }

  async run(options) {
    this.calls.push({ ...options });
    return super.run(options);
  }
}

class LegacyRecoveringContextweaveCli extends MemoryContextweaveCli {
  constructor() {
    super();
    this.calls = [];
  }

  async listBooks() {
    return [
      {
        project: {
          project_id: "legacy-series-book",
          name: "Series tt14596630 -> chi"
        },
        target_language: "",
        progress_summary: "10/10 translated",
        modified_at: 200
      }
    ];
  }

  async run(options) {
    this.calls.push({ ...options });
    return super.run(options);
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
const path = require("node:path");
const args = process.argv.slice(2);
const callsPath = process.env.FAKE_CONTEXTWEAVE_CALLS;
const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf8")) : [];
calls.push(args);
fs.writeFileSync(callsPath, JSON.stringify(calls, null, 2));

if (args.includes("books") && args.includes("list")) {
  console.log(JSON.stringify({
    ok: true,
    command: "books.list",
    data: {
      items: []
    },
    warnings: []
  }));
  process.exit(0);
}

const outputPath = args[args.indexOf("--output") + 1];
const bookIdIndex = args.indexOf("--book-id");
const bookId = bookIdIndex >= 0 ? args[bookIdIndex + 1] : "book-created-1";
const libraryRootIndex = args.indexOf("--library-root");
const libraryRoot = libraryRootIndex >= 0 ? args[libraryRootIndex + 1] : "";
if (libraryRoot) {
  const bookDir = path.join(libraryRoot, "books", bookId);
  fs.mkdirSync(bookDir, { recursive: true });
  fs.writeFileSync(path.join(bookDir, "book.db"), "fake", "utf8");
}
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

function failingCliScript() {
  return `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const callsPath = process.env.FAKE_CONTEXTWEAVE_CALLS;
const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, "utf8")) : [];
calls.push(args);
fs.writeFileSync(callsPath, JSON.stringify(calls, null, 2));

if (args.includes("books") && args.includes("list")) {
  console.log(JSON.stringify({
    ok: true,
    command: "books.list",
    data: {
      items: []
    },
    warnings: []
  }));
  process.exit(0);
}

const outputPath = args[args.indexOf("--output") + 1];
const bookIdIndex = args.indexOf("--book-id");
const libraryRootIndex = args.indexOf("--library-root");
const libraryRoot = libraryRootIndex >= 0 ? args[libraryRootIndex + 1] : "";
if (bookIdIndex === -1) {
  if (libraryRoot) {
    const bookDir = path.join(libraryRoot, "books", "book-created-on-failure");
    fs.mkdirSync(bookDir, { recursive: true });
    fs.writeFileSync(path.join(bookDir, "book.db"), "fake", "utf8");
  }
  console.log(JSON.stringify({
    ok: false,
    command: "run",
    error: {
      code: "task_failed",
      message: "Translate and Export did not complete successfully.",
      details: {
        book_id: "book-created-on-failure",
        project_id: "book-created-on-failure"
      }
    },
    warnings: []
  }));
  process.exit(1);
}

if (libraryRoot) {
  const bookDir = path.join(libraryRoot, "books", args[bookIdIndex + 1]);
  fs.mkdirSync(bookDir, { recursive: true });
  fs.writeFileSync(path.join(bookDir, "book.db"), "fake", "utf8");
}
fs.writeFileSync(outputPath, "1\\n00:00:01,000 --> 00:00:02,000\\nTranslated with recovered book\\n", "utf8");
console.log(JSON.stringify({
  ok: true,
  command: "run",
  data: {
    book_id: args[bookIdIndex + 1],
    project_id: args[bookIdIndex + 1],
    document_id: calls.length,
    task_id: "task-" + calls.length,
    status: "completed",
    output_path: outputPath
  },
  warnings: []
}));
`;
}
