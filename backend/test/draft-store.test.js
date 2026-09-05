import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DraftStore, REJECTED_DRAFT_RETENTION_MS, migrateDraftFiles } from "../src/draft-store.js";

test("drafts remain available after recreating the store", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bxb-draft-store-"));
  try {
    const draftDir = path.join(root, "drafts");
    const draft = {
      draftId: "draft_restart_test",
      status: "approved",
      draftText: "Persistent draft",
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    };

    await new DraftStore(draftDir).save(draft);
    const loaded = await new DraftStore(draftDir).list();
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0], draft);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy drafts migrate without replacing a newer target", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bxb-draft-migration-"));
  try {
    const sourceDir = path.join(root, "legacy");
    const targetDir = path.join(root, "current");
    await mkdir(sourceDir, { recursive: true });

    const legacyDraft = {
      draftId: "draft_legacy",
      status: "pending_review",
      draftText: "Recovered draft",
      updatedAt: "2026-09-03T00:00:00.000Z",
    };
    await writeFile(path.join(sourceDir, "legacy.json"), JSON.stringify(legacyDraft), "utf8");
    assert.equal(await migrateDraftFiles([sourceDir], targetDir), 1);
    assert.deepEqual(JSON.parse(await readFile(path.join(targetDir, "draft_legacy.json"), "utf8")), legacyDraft);

    const newerDraft = { ...legacyDraft, draftText: "Newer draft", updatedAt: "2026-09-04T00:00:00.000Z" };
    await new DraftStore(targetDir).save(newerDraft);
    assert.equal(await migrateDraftFiles([sourceDir], targetDir), 0);
    assert.deepEqual(await new DraftStore(targetDir).get(legacyDraft.draftId), newerDraft);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejected drafts are automatically deleted 24 hours after rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bxb-rejected-draft-cleanup-"));
  try {
    const now = Date.parse("2026-09-05T12:00:00.000Z");
    const draftDir = path.join(root, "drafts");
    const store = new DraftStore(draftDir, { now: () => now });
    const expiredAt = new Date(now - REJECTED_DRAFT_RETENTION_MS).toISOString();
    const recentAt = new Date(now - REJECTED_DRAFT_RETENTION_MS + 1).toISOString();

    await store.save({ draftId: "expired", status: "rejected", rejectedAt: expiredAt });
    await store.save({ draftId: "recent", status: "rejected", rejectedAt: recentAt });
    await store.save({ draftId: "approved", status: "approved", reviewedAt: expiredAt });

    const drafts = await store.list();
    assert.deepEqual(drafts.map((draft) => draft.draftId).sort(), ["approved", "recent"]);
    assert.equal(await store.get("expired"), null);
    assert.ok(await store.get("recent"));
    assert.ok(await store.get("approved"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy rejected drafts use reviewedAt as the retention start", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bxb-legacy-rejected-cleanup-"));
  try {
    const now = Date.parse("2026-09-05T12:00:00.000Z");
    const draftDir = path.join(root, "drafts");
    const store = new DraftStore(draftDir, { now: () => now });
    const reviewedAt = new Date(now - REJECTED_DRAFT_RETENTION_MS - 1).toISOString();
    await store.save({ draftId: "legacy-rejected", status: "rejected", reviewedAt });

    const result = await store.cleanupExpiredRejectedDrafts();
    assert.equal(result.deletedCount, 1);
    assert.deepEqual(result.deletedDraftIds, ["legacy-rejected"]);
    assert.equal(await store.get("legacy-rejected"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
