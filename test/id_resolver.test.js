const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { IdResolver } = require("../src/idResolver");

test("ID resolver maps TMDB ids to IMDB ids through Wikidata", async () => {
  const resolver = new IdResolver({
    fetchImpl: async () => new Response(JSON.stringify({
      results: {
        bindings: [{ imdb: { value: "tt0944947" } }]
      }
    }))
  });

  const resolved = await resolver.resolve({ tmdbId: "1399", rootId: "tmdb:1399" });

  assert.equal(resolved.imdbId, "tt0944947");
});

test("ID resolver loads cached anime-list mappings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-id-resolver-"));
  await fs.writeFile(path.join(tmp, "anime-list-full.json"), JSON.stringify([
    { kitsu_id: 1234, mal_id: 5678, imdb_id: "tt9999999", themoviedb_id: 42 }
  ]));
  const resolver = new IdResolver({ dataDir: tmp, fetchImpl: null });

  const resolved = await resolver.resolve({ animeIdType: "kitsu", animeNumericId: "1234", rootId: "kitsu:1234" });

  assert.equal(resolved.imdbId, "tt9999999");
  assert.equal(resolved.tmdbId, "42");
});

test("ID resolver chains anime TMDB mappings through Wikidata when IMDB is missing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-id-resolver-"));
  await fs.writeFile(path.join(tmp, "anime-list-full.json"), JSON.stringify([
    { kitsu_id: 1234, imdb_id: "", themoviedb_id: 42 }
  ]));
  const resolver = new IdResolver({
    dataDir: tmp,
    fetchImpl: async () => new Response(JSON.stringify({
      results: {
        bindings: [{ imdb: { value: "tt1234567" } }]
      }
    }))
  });

  const resolved = await resolver.resolve({ animeIdType: "kitsu", animeNumericId: "1234", rootId: "kitsu:1234" });

  assert.equal(resolved.tmdbId, "42");
  assert.equal(resolved.imdbId, "tt1234567");
});
