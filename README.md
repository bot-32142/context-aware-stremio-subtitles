# Context-Aware Stremio Subtitles

Local Stremio subtitle addon. It fetches subtitles from Stremio-compatible subtitle providers and translates selected subtitles with `cat-cli`.

The important behavior is CAT book reuse: the first translation for a show/target language creates a CAT book with `--book-name`, stores the returned `book_id`, and later episodes/seasons use `--book-id` so the glossary/context table is shared.

## Quick Start

Run this command and replace `sk-your-deepseek-key` with your DeepSeek API key. Change `Chinese` if you want another target language:

```bash
TARGET_LANGUAGE=Chinese DEEPSEEK_API_KEY="sk-your-deepseek-key" docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

This starts the addon on port `7001` and bind-mounts `./data` to `/data` in the container, so the CAT book registry, translation cache, anime ID cache, and CAT library persist on the host.

On startup the server prints the manifest URL you can paste into Stremio:

```text
http://<host-ip>:7001/manifest.json
```

The addon root also redirects to the manifest:

```text
http://<host-ip>:7001/
```

For a human-readable status page, open:

```text
http://<host-ip>:7001/help
```

`HOST=0.0.0.0` is the default so the addon listens on your LAN, not only on localhost.

If your machine firewall blocks inbound TCP `7001`, you will need to allow that port before other devices on the LAN can reach the addon.

The quick-start command enables translation with the default DeepSeek budget profile. First translation can be slow while Docker/uv prepares the CAT environment, but the cache is persisted in `./data`.

To translate into a different language, set `TARGET_LANGUAGE`:

```bash
TARGET_LANGUAGE=Spanish DEEPSEEK_API_KEY="sk-your-deepseek-key" docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

`TARGET_LANGUAGE` is the single target language input for the Docker profiles. It accepts language names like `English`, `Spanish`, or `Traditional Chinese`, and common ISO codes like `eng`, `spa`, or `chi`. The addon derives Stremio's language code and CAT's human-readable target from that one value.

Common examples:

| Target | Command prefix |
| --- | --- |
| Chinese | `TARGET_LANGUAGE=Chinese` |
| English | `TARGET_LANGUAGE=English` |
| Spanish | `TARGET_LANGUAGE=Spanish` |
| Japanese | `TARGET_LANGUAGE=Japanese` |
| Korean | `TARGET_LANGUAGE=Korean` |
| Traditional Chinese | `TARGET_LANGUAGE="Traditional Chinese"` |
| Brazilian Portuguese | `TARGET_LANGUAGE="Brazilian Portuguese"` |

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

## Docker Profiles

The Compose file uses provider profile env files in `docker/profiles/`. Pick one by setting `ADDON_PROFILE_FILE`; provider API keys are regular environment variables, so they can live in your shell or Compose `.env`.

Default public providers:

```bash
docker compose up -d --build
```

All provider adapters:

```bash
ADDON_PROFILE_FILE=./docker/profiles/all-providers.env \
SUBDL_API_KEY=... \
SUBSOURCE_API_KEY=... \
SUBSRO_API_KEY=... \
WYZIE_API_KEY=... \
docker compose up -d --build
```

Provider-specific profiles are also available: `subdl.env`, `subsource.env`, `subsro.env`, and `wyzie.env`.

Equivalent `docker run` example:

```bash
docker build -t context-aware-stremio-subtitles:local .
docker run -d --name context-aware-stremio-subtitles \
  -p 7001:7001 \
  -v "$PWD/data:/data" \
  --env-file docker/profiles/public.env \
  context-aware-stremio-subtitles:local
```

The image includes `uv` so it can run `cat-cli` from CAT v2.4.0 without installing Python tooling on the host. It also includes two ready-to-use CAT configs:

- `docker/cat-configs/templates/deepseek-budget.yaml`: default. Uses DeepSeek V4 Flash for glossary translation, main translation, and polish; uses DeepSeek V4 Pro for review.
- `docker/cat-configs/templates/deepseek-balanced.yaml`: uses DeepSeek V4 Pro for glossary translation, main translation, polish, and review.

Both bundled configs use `api_key_env: DEEPSEEK_API_KEY`. At startup Docker renders them into `/data/cat-configs/` with `target_language` set from `TARGET_LANGUAGE`. The built-in profile is intended for one target language per running container.

CAT translation with the default DeepSeek budget profile is the Quick Start command:

```bash
TARGET_LANGUAGE=Chinese DEEPSEEK_API_KEY="sk-your-deepseek-key" docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

CAT translation with the DeepSeek balanced profile:

```bash
CAT_PROFILE_FILE=./docker/profiles/translation-deepseek-balanced.env \
DEEPSEEK_API_KEY="sk-your-deepseek-key" \
docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

CAT translation with your own CAT config:

```bash
CAT_CONFIG_PATH=/path/to/cat.yaml \
DEEPSEEK_API_KEY="sk-your-deepseek-key" \
docker compose \
  -f docker-compose.yml \
  -f docker-compose.translation.yml \
  -f docker-compose.custom-cat-config.yml \
  up -d --build
```

The translation override stores uv/Python cache plus CAT output under `./data`. First startup can be slow while `uv` creates the CAT environment.

Subtitle-only mode without CAT translation:

```bash
docker compose up -d --build
```

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
