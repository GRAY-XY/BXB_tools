import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BanxuebangClient } from "../src/banxuebang-client.js";

test("workspace files can be renamed without overwriting and explicitly deleted", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-workspace-files-"));
  const workspace = path.join(root, "workspace");
  const previousWorkspace = process.env.BANXUEBANG_WORKSPACE_DIR;
  process.env.BANXUEBANG_WORKSPACE_DIR = workspace;
  context.after(async () => {
    if (previousWorkspace === undefined) delete process.env.BANXUEBANG_WORKSPACE_DIR;
    else process.env.BANXUEBANG_WORKSPACE_DIR = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  });

  const folder = path.join(workspace, "imports");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "original.txt"), "original", "utf8");
  const client = new BanxuebangClient({ load: async () => null }, {});

  const renamed = await client.renameWorkspaceFile({ file: "imports/original.txt", newName: "renamed" });
  assert.equal(renamed.file.name, "renamed.txt");
  assert.equal(renamed.file.relativePath, "imports/renamed.txt");
  assert.equal(await fs.readFile(path.join(folder, "renamed.txt"), "utf8"), "original");

  await fs.writeFile(path.join(folder, "occupied.txt"), "occupied", "utf8");
  await assert.rejects(
    client.renameWorkspaceFile({ file: "imports/renamed.txt", newName: "occupied.txt" }),
    /already exists/,
  );
  assert.equal(await fs.readFile(path.join(folder, "occupied.txt"), "utf8"), "occupied");

  const deleted = await client.deleteWorkspaceFile({ file: "imports/renamed.txt" });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted.relativePath, "imports/renamed.txt");
  await assert.rejects(fs.stat(path.join(folder, "renamed.txt")), { code: "ENOENT" });
  await assert.rejects(client.deleteWorkspaceFile({ file: path.join(root, "outside.txt") }), /was not found/);
});
