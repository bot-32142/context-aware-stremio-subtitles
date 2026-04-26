const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BookRegistry } = require("../src/bookRegistry");
const { buildCatCliArgs, splitCommand } = require("../src/catCli");
const { mediaContextKey, parseStremioId } = require("../src/media");

test("series context key ignores season and episode", () => {
  const episode1 = parseStremioId("series", "tt0944947:1:1");
  const episode2 = parseStremioId("series", "tt0944947:4:10");

  assert.equal(mediaContextKey(episode1, "chi"), "series:tt0944947:chi");
  assert.equal(mediaContextKey(episode2, "chi"), "series:tt0944947:chi");
});

test("movie context key is scoped separately from series", () => {
  const movie = parseStremioId("movie", "tt0111161");

  assert.equal(mediaContextKey(movie, "eng"), "movie:tt0111161:eng");
});

test("book registry persists book ids", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-registry-"));
  const registryPath = path.join(tmp, "registry.json");
  const registry = new BookRegistry(registryPath);

  await registry.set("series:tt1:chi", {
    bookId: "book-1",
    bookName: "Series tt1 -> chi",
    targetLanguage: "chi"
  });

  const reloaded = new BookRegistry(registryPath);
  assert.equal((await reloaded.get("series:tt1:chi")).bookId, "book-1");
});

test("cat-cli args use config only when creating a new book", () => {
  const createArgs = buildCatCliArgs({
    libraryRoot: "/library",
    configPath: "/cat.yaml",
    inputPath: "/in.srt",
    outputPath: "/out.srt",
    bookName: "Series tt1 -> chi",
    format: "srt"
  });

  assert.deepEqual(createArgs.slice(0, 5), ["--library-root", "/library", "--config", "/cat.yaml", "--json"]);
  assert.equal(createArgs.includes("--book-name"), true);
  assert.equal(createArgs.includes("--book-id"), false);

  const reuseArgs = buildCatCliArgs({
    libraryRoot: "/library",
    configPath: "/cat.yaml",
    inputPath: "/in.srt",
    outputPath: "/out.srt",
    bookId: "book-1",
    format: "srt"
  });

  assert.equal(reuseArgs.includes("--book-id"), true);
  assert.equal(reuseArgs.includes("--book-name"), false);
  assert.equal(reuseArgs.includes("--config"), false);
});

test("CAT_CLI_CMD splitting supports quoted args", () => {
  assert.deepEqual(splitCommand('uv --directory "/home/me/context aware" run cat-cli'), [
    "uv",
    "--directory",
    "/home/me/context aware",
    "run",
    "cat-cli"
  ]);
});
