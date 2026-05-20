const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BookRegistry } = require("../src/bookRegistry");
const { buildContextweaveCliArgs, splitCommand } = require("../src/contextweaveCli");
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

test("tmdb ids are accepted and scoped by root id", () => {
  const episode = parseStremioId("series", "tmdb:1399:2:10");

  assert.equal(episode.tmdbId, "1399");
  assert.equal(episode.season, 2);
  assert.equal(episode.episode, 10);
  assert.equal(episode.isEpisode, true);
  assert.equal(mediaContextKey(episode, "chi"), "series:tmdb:1399:chi");
});

test("anime catalog ids are accepted for provider resolution", () => {
  const episode = parseStremioId("anime", "kitsu:1234:7");

  assert.equal(episode.animeId, "kitsu:1234");
  assert.equal(episode.animeIdType, "kitsu");
  assert.equal(episode.episode, 7);
  assert.equal(episode.isEpisode, true);
  assert.equal(mediaContextKey(episode, "jpn"), "anime:kitsu:1234:jpn");
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

test("contextweave-cli args use config only when creating a new book", () => {
  const createArgs = buildContextweaveCliArgs({
    libraryRoot: "/library",
    configPath: "/contextweave.yaml",
    inputPath: "/in.srt",
    outputPath: "/out.srt",
    bookName: "Series tt1 -> chi",
    format: "srt"
  });

  assert.deepEqual(createArgs.slice(0, 5), ["--library-root", "/library", "--config", "/contextweave.yaml", "--json"]);
  assert.equal(createArgs.includes("--book-name"), true);
  assert.equal(createArgs.includes("--book-id"), false);

  const reuseArgs = buildContextweaveCliArgs({
    libraryRoot: "/library",
    configPath: "/contextweave.yaml",
    inputPath: "/in.srt",
    outputPath: "/out.srt",
    bookId: "book-1",
    format: "srt"
  });

  assert.equal(reuseArgs.includes("--book-id"), true);
  assert.equal(reuseArgs.includes("--book-name"), false);
  assert.equal(reuseArgs.includes("--config"), false);
});

test("contextweave-cli args can disable polish for subtitle jobs", () => {
  const args = buildContextweaveCliArgs({
    libraryRoot: "/library",
    configPath: "/contextweave.yaml",
    inputPath: "/in.srt",
    outputPath: "/out.srt",
    bookName: "Series tt1 -> chi",
    format: "srt",
    noPolish: true
  });

  assert.deepEqual(args.slice(4, 7), ["--json", "run", "--no-polish"]);
});

test("CONTEXTWEAVE_CLI_CMD splitting supports quoted args", () => {
  assert.deepEqual(splitCommand('uv --directory "checkout/context aware" run contextweave-cli'), [
    "uv",
    "--directory",
    "checkout/context aware",
    "run",
    "contextweave-cli"
  ]);
});
