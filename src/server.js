require("dotenv").config();

const { createApp } = require("./app");
const { loadConfig } = require("./config");

const config = loadConfig();
const app = createApp({ config });

app.listen(config.port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Context-aware Stremio subtitles listening on http://0.0.0.0:${config.port}`);
});
