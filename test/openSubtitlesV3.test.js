const assert = require("node:assert/strict");
const test = require("node:test");
const JSZip = require("jszip");
const { OpenSubtitlesV3Provider, encodeFileId } = require("../src/openSubtitlesV3");

test("OpenSubtitles V3 provider extracts subtitles from zip downloads", async () => {
  const zip = new JSZip();
  zip.file("episode.srt", "1\n00:00:01,000 --> 00:00:02,000\nHello from zip\n");
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer" });
  const provider = new OpenSubtitlesV3Provider({
    fetchImpl: async () => new Response(archiveBytes)
  });

  const downloaded = await provider.download(encodeFileId("https://example.test/episode.zip"));

  assert.equal(downloaded.format, "srt");
  assert.match(downloaded.content, /Hello from zip/);
});

test("OpenSubtitles V3 provider rejects unsupported archives clearly", async () => {
  const provider = new OpenSubtitlesV3Provider({
    fetchImpl: async () => new Response(Buffer.from("Rar!\x1A\x07\x00unsupported", "latin1"))
  });

  await assert.rejects(
    () => provider.download(encodeFileId("https://example.test/episode.rar")),
    /archive format/
  );
});
