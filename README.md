# Context-Aware Stremio Subtitles

Local Stremio subtitle addon for a personal mini-pc. It fetches subtitles from Stremio-compatible subtitle providers and translates selected subtitles with `cat-cli`.

The important behavior is CAT book reuse: the first translation for a show/target language creates a CAT book with `--book-name`, stores the returned `book_id`, and later episodes/seasons use `--book-id` so the glossary/context table is shared.

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

On startup the server prints the manifest URL you can paste into Stremio.

The addon root also redirects to the manifest, so both of these work:

```text
http://<mini-pc-ip>:7001/
http://<mini-pc-ip>:7001/manifest.json
```

For a human-readable status page, open:

```text
http://<mini-pc-ip>:7001/help
```

`HOST=0.0.0.0` is the default so the addon listens on your LAN, not only on localhost.

If your machine firewall blocks inbound TCP `7001`, you will need to allow that port before other devices on the LAN can reach the addon.

Translation is disabled by default until `CAT_CLI_CMD` and `CAT_CONFIG` are set up. The addon still works as a LAN subtitle addon without CAT; it just will not show `Make <language>` entries yet.

## Subtitle Providers

`SUBTITLE_PROVIDERS` is comma-separated. Supported values:

- `opensubtitles-v3`: public OpenSubtitles V3 Stremio endpoint.
- `scs`: Stremio Community Subtitles, using the default public manifest token unless `SCS_MANIFEST_TOKEN` is set.
- `subdl`: SubDL, requires `SUBDL_API_KEY`.
- `subsource`: SubSource, requires `SUBSOURCE_API_KEY`.
- `subsro`: Subs.ro, requires `SUBSRO_API_KEY`.
- `wyzie`: Wyzie Subs, requires `WYZIE_API_KEY`.

The default is `opensubtitles-v3,scs`. Provider results are searched in parallel, deduplicated, filtered, and ranked by filename/release match before Stremio sees them.

The addon also accepts IMDb, TMDB, and common anime catalog IDs (`kitsu`, `mal`, `anidb`, `anilist`). TMDB IDs are resolved to IMDb through Wikidata when needed. Anime IDs can be resolved through a cached `data/anime-list-full.json`; if missing, the resolver tries to download the Fribb anime list on first use.

Subtitle downloads now handle ZIP/RAR/GZIP/TAR archives, reject unsupported archive formats clearly, and decode common legacy subtitle encodings before passing text to Stremio or CAT.

## CAT CLI Setup

Set `ENABLE_TRANSLATION=true` only after `CAT_CLI_CMD` points to a working CLI and `CAT_CONFIG` points to a valid CAT config file.

`CAT_CLI_CMD` should point to a working `cat-cli` checkout or installation.

Set `CAT_NO_POLISH=true` if you want the addon to invoke `cat-cli run --no-polish ...` for subtitle jobs.

For a source checkout:

```bash
CAT_CLI_CMD="uv --directory <path-to-context-aware-translation> run cat-cli"
CAT_NO_POLISH=true
CAT_CONFIG=<path-to-cat-config>
```

For first use of a show/target language, the addon runs:

```bash
cat-cli --library-root ./data/cat-library --config /path/cat.yaml --json run --no-polish input.srt --output output.srt --book-name "Series tt0944947 -> chi" --type subtitle --format srt
```

After `cat-cli` returns `data.book_id`, later episodes use:

```bash
cat-cli --library-root ./data/cat-library --json run --no-polish input.srt --output output.srt --book-id <stored-book-id> --type subtitle --format srt
```

`--config` is intentionally omitted with `--book-id`, because the existing CAT book already owns its config.

## Files

- `data/book-registry.json`: media-context to CAT `book_id` registry.
- `data/translations/`: completed subtitle translation cache.
- `data/tmp/`: temporary source/output files passed to `cat-cli`.
- `data/cat-library/`: CAT library root used by `cat-cli`.

## Tests

```bash
npm test
```

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).
