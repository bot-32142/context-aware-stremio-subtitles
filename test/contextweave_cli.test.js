const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { contextweaveConfigFingerprint } = require("../src/contextweaveCli");

test("contextweaveConfigFingerprint is stable across mtime-only changes", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "contextweave-cli-fingerprint-"));
  const configPath = path.join(tmp, "contextweave.yaml");
  await fs.writeFile(configPath, "version: 1\nprofile: budget\n", "utf8");

  const first = await contextweaveConfigFingerprint(configPath);
  const stat = await fs.stat(configPath);
  await fs.utimes(configPath, stat.atime, new Date(stat.mtimeMs + 60_000));
  const second = await contextweaveConfigFingerprint(configPath);

  assert.equal(first, second);
});
