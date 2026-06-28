import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultDraftDir = () =>
  process.env.BANXUEBANG_DRAFT_DIR ||
  path.join(process.cwd(), ".banxuebang", "drafts");

export class DraftStore {
  constructor(draftDir = defaultDraftDir()) {
    this.draftDir = draftDir;
  }

  async list() {
    await mkdir(this.draftDir, { recursive: true });
    const entries = await readdir(this.draftDir, { withFileTypes: true });
    const drafts = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const filePath = path.join(this.draftDir, entry.name);
      try {
        const raw = await readFile(filePath, "utf8");
        drafts.push(JSON.parse(raw));
      } catch {
        // Ignore malformed draft files so one bad artifact does not break the whole store.
      }
    }

    drafts.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || 0) || 0;
      const rightTime = Date.parse(right.updatedAt || right.createdAt || 0) || 0;
      return rightTime - leftTime;
    });
    return drafts;
  }

  async get(draftId) {
    const filePath = this._filePath(draftId);
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(draft) {
    await mkdir(this.draftDir, { recursive: true });
    const filePath = this._filePath(draft.draftId);
    await writeFile(filePath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    return draft;
  }

  async update(draftId, updater) {
    const current = await this.get(draftId);
    if (!current) {
      return null;
    }

    const updated = await updater(current);
    await this.save(updated);
    return updated;
  }

  async clear(draftId) {
    const filePath = this._filePath(draftId);
    try {
      await rm(filePath, { force: true });
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  _filePath(draftId) {
    const safeId = String(draftId || "").replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.draftDir, `${safeId}.json`);
  }
}
