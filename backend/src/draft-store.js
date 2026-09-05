import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultDraftDir = () =>
  process.env.BANXUEBANG_DRAFT_DIR ||
  path.join(process.cwd(), ".banxuebang", "drafts");

const safeDraftId = (draftId) => String(draftId || "").replace(/[^a-zA-Z0-9._-]/g, "_");

export const REJECTED_DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

function draftTimestamp(draft) {
  return Date.parse(draft?.updatedAt || draft?.createdAt || 0) || 0;
}

function rejectedDraftTimestamp(draft) {
  return Date.parse(draft?.rejectedAt || draft?.reviewedAt || draft?.updatedAt || draft?.createdAt || 0) || 0;
}

function isExpiredRejectedDraft(draft, now) {
  if (String(draft?.status || "") !== "rejected") return false;
  const rejectedAt = rejectedDraftTimestamp(draft);
  return rejectedAt > 0 && now >= rejectedAt + REJECTED_DRAFT_RETENTION_MS;
}

export async function migrateDraftFiles(sourceDirs, targetDir) {
  const targetRoot = path.resolve(targetDir);
  await mkdir(targetRoot, { recursive: true });
  let migrated = 0;

  for (const sourceDir of new Set(sourceDirs.map((item) => path.resolve(item)))) {
    if (sourceDir === targetRoot) continue;

    let entries;
    try {
      entries = await readdir(sourceDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

      try {
        const sourceDraft = JSON.parse(await readFile(path.join(sourceDir, entry.name), "utf8"));
        if (!sourceDraft?.draftId) continue;

        const targetPath = path.join(targetRoot, `${safeDraftId(sourceDraft.draftId)}.json`);
        let targetDraft = null;
        try {
          targetDraft = JSON.parse(await readFile(targetPath, "utf8"));
        } catch (error) {
          if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }

        if (targetDraft && draftTimestamp(targetDraft) >= draftTimestamp(sourceDraft)) continue;
        await writeFile(targetPath, `${JSON.stringify(sourceDraft, null, 2)}\n`, "utf8");
        migrated += 1;
      } catch {
        // A malformed legacy file must not block startup or other drafts.
      }
    }
  }

  return migrated;
}

export class DraftStore {
  constructor(draftDir = defaultDraftDir(), { now = () => Date.now() } = {}) {
    this.draftDir = draftDir;
    this.now = now;
  }

  async cleanupExpiredRejectedDrafts({ now = this.now() } = {}) {
    await mkdir(this.draftDir, { recursive: true });
    const entries = await readdir(this.draftDir, { withFileTypes: true });
    const deletedDraftIds = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(this.draftDir, entry.name);
      try {
        const draft = JSON.parse(await readFile(filePath, "utf8"));
        if (!isExpiredRejectedDraft(draft, Number(now))) continue;
        await rm(filePath, { force: true });
        deletedDraftIds.push(String(draft.draftId || entry.name.slice(0, -5)));
      } catch {
        // Malformed or temporarily locked files must not block cleanup of other drafts.
      }
    }

    return { deletedCount: deletedDraftIds.length, deletedDraftIds };
  }

  async list() {
    await this.cleanupExpiredRejectedDrafts();
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
      const draft = JSON.parse(raw);
      if (isExpiredRejectedDraft(draft, this.now())) {
        await rm(filePath, { force: true });
        return null;
      }
      return draft;
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
    return path.join(this.draftDir, `${safeDraftId(draftId)}.json`);
  }
}
