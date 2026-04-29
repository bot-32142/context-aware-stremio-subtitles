# Context-Aware Stremio Subtitles

Local Stremio subtitle addon. It fetches subtitles from Stremio-compatible subtitle providers and translates selected subtitles with `cat-cli`.

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

## Consistency

When translation is enabled, the addon reuses one CAT book per show and target language. That helps keep terminology and phrasing more consistent across episodes and seasons.

The tradeoff is speed: translated subtitles are slower than plain subtitle results, and the first translation for a show is usually the slowest.

## Configure

You can either:

- pass env vars inline on the command line
- or copy `.env.example` to `.env` and edit it

Minimal `.env` for translated subtitles:

```dotenv
HOST_PORT=7001
TARGET_LANGUAGE=Chinese
DEEPSEEK_API_KEY=sk-your-deepseek-key
CAT_PROFILE_FILE=./docker/profiles/translation-deepseek-budget.env
```

Then start it with:

```bash
docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

## Important Env Vars

| Variable | What it does |
| --- | --- |
| `TARGET_LANGUAGE` | One target language for translated subtitles. Examples: `Chinese`, `English`, `Spanish`, `Japanese`, `Korean`, `Traditional Chinese`, `eng`, `spa`, `chi`. |
| `DEEPSEEK_API_KEY` | Required for the built-in DeepSeek CAT profiles. |
| `CAT_PROFILE_FILE` | Translation profile. Usually `./docker/profiles/translation-deepseek-budget.env` or `./docker/profiles/translation-deepseek-balanced.env`. |
| `ADDON_PROFILE_FILE` | Subtitle provider profile. Default is `./docker/profiles/public.env`. |
| `HOST_PORT` | Host port. Default is `7001`. |
| `SUBTITLE_PROVIDERS` | Optional comma-separated override such as `opensubtitles-v3,scs` or `subdl,subsource`. |
| `CAT_CONFIG_PATH` | Only used with `docker-compose.custom-cat-config.yml` when you want your own CAT config file. |

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
CAT_PROFILE_FILE=./docker/profiles/translation-deepseek-balanced.env DEEPSEEK_API_KEY="sk-your-deepseek-key" docker compose -f docker-compose.yml -f docker-compose.translation.yml up -d --build
```

Subtitle-only mode, no CAT translation:

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

Custom CAT config:

```bash
CAT_CONFIG_PATH=/path/to/cat.yaml \
DEEPSEEK_API_KEY="sk-your-deepseek-key" \
docker compose -f docker-compose.yml -f docker-compose.translation.yml -f docker-compose.custom-cat-config.yml up -d --build
```

## CAT Profiles

- `translation-deepseek-budget.env`: default cheaper profile
- `translation-deepseek-balanced.env`: more Pro usage
- `docker-compose.custom-cat-config.yml`: use your own `cat.yaml`

The built-in Docker translation profiles already set:

- `ENABLE_TRANSLATION=true`
- `CAT_NO_POLISH=true`
- `CAT_LIBRARY_ROOT=/data/cat-library`
- `TMP_DIR=/data/tmp`
- `TRANSLATION_DIR=/data/translations`

## Notes

- Data is persisted in `./data`.
- The first translation can be slow while Docker and `uv` prepare the CAT environment.
- If your firewall blocks inbound TCP `7001`, allow that port for LAN access.
- The addon reuses one CAT book per show and target language.

## Tests

```bash
npm test
```

## License

AGPL-3.0-only. See [LICENSE](./LICENSE).
