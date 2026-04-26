# Context-Aware Stremio Subtitles

Local Stremio subtitle addon for a personal mini-pc. It fetches subtitles from the public OpenSubtitles V3 Stremio endpoint and translates selected subtitles with `cat-cli`.

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

## CAT CLI Setup

Set `ENABLE_TRANSLATION=true` only after `CAT_CLI_CMD` points to a working CLI and `CAT_CONFIG` points to a valid CAT config file.

`CAT_CLI_CMD` should point to the CLI added in `~/workspace2/context-aware-translation`.

For a source checkout:

```bash
CAT_CLI_CMD="uv --directory /home/mini/context-aware-translation run cat-cli"
CAT_CONFIG=/home/mini/context-aware-translation/cat.yaml
```

For first use of a show/target language, the addon runs:

```bash
cat-cli --library-root ./data/cat-library --config /path/cat.yaml --json run input.srt --output output.srt --book-name "Series tt0944947 -> chi" --type subtitle --format srt
```

After `cat-cli` returns `data.book_id`, later episodes use:

```bash
cat-cli --library-root ./data/cat-library --json run input.srt --output output.srt --book-id <stored-book-id> --type subtitle --format srt
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
