const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { catConfigFingerprint } = require("../src/catCli");

test("catConfigFingerprint is stable across mtime-only changes", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cat-cli-fingerprint-"));
  const configPath = path.join(tmp, "cat.yaml");
  await fs.writeFile(configPath, "version: 1\nprofile: budget\n", "utf8");

  const first = await catConfigFingerprint(configPath);
  const stat = await fs.stat(configPath);
  await fs.utimes(configPath, stat.atime, new Date(stat.mtimeMs + 60_000));
  const second = await catConfigFingerprint(configPath);

  assert.equal(first, second);
});
