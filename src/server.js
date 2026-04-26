require("dotenv").config();

const { createApp } = require("./app");
const { advertisedBaseUrls, loadConfig } = require("./config");

const config = loadConfig();
const app = createApp({ config });

app.listen(config.port, config.host, () => {
  const baseUrls = advertisedBaseUrls(config);
  // eslint-disable-next-line no-console
  console.log(`Context-aware Stremio subtitles listening on ${config.host}:${config.port}`);
  for (const baseUrl of baseUrls) {
    // eslint-disable-next-line no-console
    console.log(`Install in Stremio: ${baseUrl}/manifest.json`);
  }
});
