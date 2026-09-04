import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DraftStore, migrateDraftFiles } from "../src/draft-store.js";

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
