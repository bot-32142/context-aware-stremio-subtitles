const fs = require("node:fs/promises");
const path = require("node:path");

class BookRegistry {
  constructor(filePath) {
    this.filePath = filePath;
    this._loaded = false;
    this._data = { books: {} };
    this._writeChain = Promise.resolve();
  }

  async get(key) {
    await this._load();
    return this._data.books[key] || null;
  }

  async set(key, entry) {
    await this._load();
    this._data.books[key] = {
      ...entry,
      updatedAt: new Date().toISOString()
    };
    await this._save();
    return this._data.books[key];
  }

  async touch(key) {
    await this._load();
    if (!this._data.books[key]) return null;
    this._data.books[key].lastUsedAt = new Date().toISOString();
    await this._save();
    return this._data.books[key];
  }

  async _load() {
    if (this._loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this._data = parsed && typeof parsed === "object" && parsed.books ? parsed : { books: {} };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this._data = { books: {} };
    }
    this._loaded = true;
  }

  async _save() {
    this._writeChain = this._writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmpPath, `${JSON.stringify(this._data, null, 2)}\n`, "utf8");
      await fs.rename(tmpPath, this.filePath);
    });
    return this._writeChain;
  }
}

module.exports = {
  BookRegistry
};
