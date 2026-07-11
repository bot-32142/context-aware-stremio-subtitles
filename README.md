# Context-Aware Stremio Subtitles

Local Stremio subtitle addon. It fetches subtitles from Stremio-compatible subtitle providers and translates selected subtitles with `contextweave-cli`.

## Quick Start

```bash
TARGET_LANGUAGE=Chinese DEEPSEEK_API_KEY="sk-your-deepseek-key" docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

Install in Stremio:

```text
http://<host-ip>:7001/manifest.json
```

The addon also responds on:

- `http://<host-ip>:7001/`
- `http://<host-ip>:7001/help`

## Motivation

The addon uses [ContextWeave](https://pypi.org/project/contextweave/) to ensure that **all terminologies are consistently translated** across different season and episode in a show. (Tests have been performed across multiple books/shows and no inconsistency in translation has been found so far.) In addition, it is recommended to **translate in chronological order** as ContextWeave uses translation order to handle context summary and injection.

The tradeoff is speed: translated subtitles are slower than plain subtitle results.

## Configure

You can either:

- pass env vars inline on the command line
- or copy `.env.example` to `.env` and edit it

Minimal `.env` for translated subtitles:

```dotenv
HOST_PORT=7001
TARGET_LANGUAGE=Chinese
DEEPSEEK_API_KEY=sk-your-deepseek-key
CONTEXTWEAVE_PROFILE_FILE=./docker/profiles/translation-deepseek-budget.env
```

Then start it with:

```bash
docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

## Important Env Vars

| Variable | What it does |
| --- | --- |
| `TARGET_LANGUAGE` | One target language for translated subtitles. Accepts names, ISO codes, or ContextWeave presets such as `Spanish`, `spa`, `Español`, and `中文（繁體）`. |
| `SOURCE_LANGUAGES` | Comma-separated source subtitle filters using names or ISO codes, for example `eng,jpn`. ContextWeave detects the selected subtitle's actual source language. |
| `DEEPSEEK_API_KEY` | Required for the built-in DeepSeek ContextWeave profiles. |
| `CONTEXTWEAVE_PROFILE_FILE` | Translation profile. Usually `./docker/profiles/translation-deepseek-budget.env` or `./docker/profiles/translation-deepseek-balanced.env`. |
| `ADDON_PROFILE_FILE` | Subtitle provider profile. Default is `./docker/profiles/public.env`. |
| `HOST_PORT` | Host port. Default is `7001`. |
| `SUBTITLE_PROVIDERS` | Optional comma-separated override such as `opensubtitles-v3,scs` or `subdl,subsource`. |
| `CONTEXTWEAVE_CONFIG_PATH` | Only used with `docker-compose.custom-contextweave-config.yml` when you want your own ContextWeave config file. |

Provider-specific optional keys:

- `SUBDL_API_KEY`
- `SUBSOURCE_API_KEY`
- `SUBSRO_API_KEY`
- `WYZIE_API_KEY`
- `SCS_MANIFEST_TOKEN`

## Common Examples

Budget profile, Chinese:

```bash
TARGET_LANGUAGE=Chinese DEEPSEEK_API_KEY="sk-your-deepseek-key" docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

Budget profile, Spanish:

```bash
TARGET_LANGUAGE=Spanish DEEPSEEK_API_KEY="sk-your-deepseek-key" docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

Balanced profile:

```bash
CONTEXTWEAVE_PROFILE_FILE=./docker/profiles/translation-deepseek-balanced.env DEEPSEEK_API_KEY="sk-your-deepseek-key" docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

Subtitle-only mode, no ContextWeave translation:

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

Custom ContextWeave config:

```bash
CONTEXTWEAVE_CONFIG_PATH=/path/to/contextweave.yaml \
DEEPSEEK_API_KEY="sk-your-deepseek-key" \
docker compose -f docker-compose.yml -f docker-compose.translation.yml -f docker-compose.custom-contextweave-config.yml up -d --build
```

## ContextWeave Profiles

- `translation-deepseek-budget.env`: default cheaper profile
- `translation-deepseek-balanced.env`: more Pro usage
- `docker-compose.custom-contextweave-config.yml`: use your own `contextweave.yaml`

The built-in Docker translation profiles already set:

- `ENABLE_TRANSLATION=true`
- `CONTEXTWEAVE_CLI_CMD=uvx --from contextweave==0.3.1 --python 3.12 --torch-backend cpu contextweave-cli`
- `CONTEXTWEAVE_NO_POLISH=true`
- `CONTEXTWEAVE_LIBRARY_ROOT=/data/cat-library`
- `TMP_DIR=/data/tmp`
- `TRANSLATION_DIR=/data/translations`

## Notes

- Data is persisted in `./data`.
- The first translation can be slow while Docker and `uv` prepare the ContextWeave environment.
- The bundled profiles pin ContextWeave package `0.3.1` (the package shipped by the v2.8.2 release) and render `TARGET_LANGUAGE` into a validated native-script preset.
- Existing books are reused only when their stored target matches that preset; incompatible legacy books are left intact and replaced with a compatible book.
- If your firewall blocks inbound TCP `7001`, allow that port for LAN access.
- The addon reuses one ContextWeave book per show and target language.

## Tests

```bash
npm test
```

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).
