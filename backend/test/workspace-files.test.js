import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BanxuebangClient } from "../src/banxuebang-client.js";

async function createClient(context, name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `bxb-${name}-`));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  const previousWorkspace = process.env.BANXUEBANG_WORKSPACE_DIR;
  process.env.BANXUEBANG_WORKSPACE_DIR = workspace;
  context.after(async () => {
    if (previousWorkspace === undefined) delete process.env.BANXUEBANG_WORKSPACE_DIR;
    else process.env.BANXUEBANG_WORKSPACE_DIR = previousWorkspace;
    await fs.rm(root, { recursive: true, force: true });
  });

  return {
    root,
    workspace,
    canonicalWorkspace: await fs.realpath(workspace),
    client: new BanxuebangClient({ load: async () => null }, {}),
  };
}

async function expectWorkspaceError(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.code, code, `expected code ${code}, received ${error.code}: ${error.message}`);
    return true;
  });
}

test("workspace files can be renamed without overwriting and explicitly deleted", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-files");

  const folder = path.join(workspace, "imports");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, "original.txt"), "original", "utf8");

  const renamed = await client.renameWorkspaceFile({ file: "imports/original.txt", newName: "renamed" });
  assert.equal(renamed.file.name, "renamed.txt");
  assert.equal(renamed.file.relativePath, "imports/renamed.txt");
  assert.equal(await fs.readFile(path.join(folder, "renamed.txt"), "utf8"), "original");

  await fs.writeFile(path.join(folder, "occupied.txt"), "occupied", "utf8");
  await expectWorkspaceError(
    client.renameWorkspaceFile({ file: "imports/renamed.txt", newName: "occupied.txt" }),
    "name_conflict",
  );
  assert.equal(await fs.readFile(path.join(folder, "occupied.txt"), "utf8"), "occupied");

  const deleted = await client.deleteWorkspaceFile({ file: "imports/renamed.txt" });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted.relativePath, "imports/renamed.txt");
  await assert.rejects(fs.stat(path.join(folder, "renamed.txt")), { code: "ENOENT" });
  await expectWorkspaceError(client.deleteWorkspaceFile({ file: "imports/renamed.txt" }), "not_found");
});

test("renaming only the letter case of a file succeeds on case-insensitive volumes", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-case");
  await fs.writeFile(path.join(workspace, "notes.txt"), "body", "utf8");

  const renamed = await client.renameWorkspaceFile({ file: "notes.txt", newName: "Notes.txt" });
  assert.equal(await fs.readFile(path.join(workspace, "Notes.txt"), "utf8"), "body");
  assert.equal(renamed.file.relativePath.toLowerCase(), "notes.txt");
});

test("rename rejects empty names, path separators, and parent references", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-name");
  await fs.writeFile(path.join(workspace, "notes.txt"), "body", "utf8");

  await expectWorkspaceError(client.renameWorkspaceFile({ file: "notes.txt", newName: "   " }), "unsupported_name");
  await expectWorkspaceError(client.renameWorkspaceFile({ file: "notes.txt", newName: "a/b.txt" }), "unsupported_name");
  await expectWorkspaceError(client.renameWorkspaceFile({ file: "notes.txt", newName: ".." }), "unsupported_name");
  assert.equal(await fs.readFile(path.join(workspace, "notes.txt"), "utf8"), "body");
  const listed = await client.listWorkspaceFiles({});
  assert.deepEqual(listed.files.map((file) => file.relativePath), ["notes.txt"]);
});

test("delete refuses the workspace root, folders, and targets that changed after confirmation", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-delete-guard");
  await fs.mkdir(path.join(workspace, "empty-folder"));
  await fs.mkdir(path.join(workspace, "archive"));
  await fs.writeFile(path.join(workspace, "archive", "kept.txt"), "keep", "utf8");
  await fs.writeFile(path.join(workspace, "final.txt"), "final", "utf8");

  await expectWorkspaceError(client.deleteWorkspaceFile({ file: "." }), "workspace_root");
  await expectWorkspaceError(client.deleteWorkspaceFile({ file: "archive" }), "directory_not_empty");
  await expectWorkspaceError(
    client.deleteWorkspaceFile({ file: "final.txt", expected: { identity: "1:1" } }),
    "target_changed",
  );
  await expectWorkspaceError(
    client.deleteWorkspaceFile({ file: "final.txt", expected: { modifiedAt: "1999-01-01T00:00:00.000Z" } }),
    "target_changed",
  );
  assert.equal(await fs.readFile(path.join(workspace, "archive", "kept.txt"), "utf8"), "keep");
  assert.equal(await fs.readFile(path.join(workspace, "final.txt"), "utf8"), "final");

  const listed = await client.listWorkspaceFiles({});
  const target = listed.files.find((file) => file.relativePath === "final.txt");
  assert.ok(target.identity, "listed files expose an identity for confirmation checks");

  const deleted = await client.deleteWorkspaceFile({
    file: "final.txt",
    expected: { identity: target.identity, modifiedAt: target.modifiedAt },
  });
  assert.equal(deleted.ok, true);
});

test("only empty folders can be deleted, and never recursively", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-folder-delete");
  await fs.mkdir(path.join(workspace, "empty-folder"));
  await fs.mkdir(path.join(workspace, "pack", "sub"), { recursive: true });
  await fs.writeFile(path.join(workspace, "pack", "sub", "kept.txt"), "keep", "utf8");

  const listed = await client.listWorkspaceFiles({ includeDirectories: true });
  const folder = listed.files.find((file) => file.relativePath === "empty-folder");
  assert.ok(folder, "folders are listed when the caller asks for them");
  assert.equal(folder.isDirectory, true);
  assert.equal(folder.category, "directory");
  assert.equal(listed.files.find((file) => file.relativePath === "pack").isDirectory, true);

  await expectWorkspaceError(client.deleteWorkspaceFile({ file: "pack" }), "directory_not_empty");
  assert.equal(await fs.readFile(path.join(workspace, "pack", "sub", "kept.txt"), "utf8"), "keep");

  await expectWorkspaceError(
    client.deleteWorkspaceFile({ file: "empty-folder", expected: { identity: "1:1" } }),
    "target_changed",
  );

  const deleted = await client.deleteWorkspaceFile({
    file: "empty-folder",
    expected: { identity: folder.identity, modifiedAt: folder.modifiedAt },
  });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted.isDirectory, true);
  await assert.rejects(fs.stat(path.join(workspace, "empty-folder")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(workspace, "pack", "sub", "kept.txt"), "utf8"), "keep");
});

test("folders are hidden from the default listing and cannot be read as files", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-folder-list");
  await fs.mkdir(path.join(workspace, "pack"));
  await fs.writeFile(path.join(workspace, "pack", "a.txt"), "a", "utf8");

  const defaultListing = await client.listWorkspaceFiles({});
  assert.deepEqual(defaultListing.files.map((file) => file.relativePath), ["pack/a.txt"]);

  const withFolders = await client.listWorkspaceFiles({ includeDirectories: true });
  assert.deepEqual(
    withFolders.files.map((file) => file.relativePath).sort(),
    ["pack", "pack/a.txt"],
  );

  await expectWorkspaceError(client.readWorkspaceFile({ file: "pack" }), "is_directory");
});

test("folders can be renamed but never onto an existing name", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-folder-rename");
  await fs.mkdir(path.join(workspace, "draft"));
  await fs.mkdir(path.join(workspace, "final"));
  await fs.writeFile(path.join(workspace, "draft", "a.txt"), "a", "utf8");

  const renamed = await client.renameWorkspaceFile({ file: "draft", newName: "draft-v2" });
  assert.equal(renamed.file.relativePath, "draft-v2");
  assert.equal(renamed.file.isDirectory, true);
  assert.equal(await fs.readFile(path.join(workspace, "draft-v2", "a.txt"), "utf8"), "a");

  await expectWorkspaceError(
    client.renameWorkspaceFile({ file: "draft-v2", newName: "final" }),
    "name_conflict",
  );
  assert.equal(await fs.readFile(path.join(workspace, "draft-v2", "a.txt"), "utf8"), "a");
});

test("workspace paths cannot escape through parent or absolute references", async (context) => {
  const { root, workspace, client } = await createClient(context, "workspace-escape");
  await fs.writeFile(path.join(root, "outside.txt"), "outside", "utf8");

  await expectWorkspaceError(client.readWorkspaceFile({ file: "../outside.txt" }), "not_found");
  await expectWorkspaceError(client.deleteWorkspaceFile({ file: path.join(root, "outside.txt") }), "not_found");
  await expectWorkspaceError(client.writeWorkspaceTextFile({ fileName: path.join(root, "evil.txt") }), "unsupported_name");
  assert.deepEqual((await client.listWorkspaceFiles({})).files, []);

  await fs.writeFile(path.join(workspace, "safe.txt"), "safe", "utf8");
  await expectWorkspaceError(client.renameWorkspaceFile({ file: "safe.txt", newName: "../evil.txt" }), "unsupported_name");
  assert.equal(await fs.readFile(path.join(workspace, "safe.txt"), "utf8"), "safe");
  assert.equal(await fs.readFile(path.join(root, "outside.txt"), "utf8"), "outside");
  await assert.rejects(fs.stat(path.join(root, "evil.txt")), { code: "ENOENT" });
  assert.deepEqual(
    (await client.listWorkspaceFiles({})).files.map((file) => file.relativePath),
    ["safe.txt"],
  );
});

test("workspace never follows a symlink that points outside", async (context) => {
  const { root, workspace, client } = await createClient(context, "workspace-symlink");
  await fs.writeFile(path.join(root, "outside.txt"), "outside", "utf8");
  await fs.symlink(path.join(root, "outside.txt"), path.join(workspace, "escape.txt"));

  await expectWorkspaceError(client.readWorkspaceFile({ file: "escape.txt" }), "blocked_symlink");
  await expectWorkspaceError(client.deleteWorkspaceFile({ file: "escape.txt" }), "blocked_symlink");
  await expectWorkspaceError(client.renameWorkspaceFile({ file: "escape.txt", newName: "renamed.txt" }), "blocked_symlink");

  assert.equal(await fs.readFile(path.join(root, "outside.txt"), "utf8"), "outside");
  assert.ok(await fs.lstat(path.join(workspace, "escape.txt")));
});

test("pasted text is created without overwriting an existing file", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-paste");

  const created = await client.writeWorkspaceTextFile({ fileName: "pasted-text.txt", content: "first" });
  assert.equal(created.file.relativePath, "pasted-text.txt");
  assert.equal(await fs.readFile(path.join(workspace, "pasted-text.txt"), "utf8"), "first");

  await expectWorkspaceError(
    client.writeWorkspaceTextFile({ fileName: "pasted-text.txt", content: "second" }),
    "name_conflict",
  );
  assert.equal(await fs.readFile(path.join(workspace, "pasted-text.txt"), "utf8"), "first");

  await client.writeWorkspaceTextFile({ fileName: "pasted-text.txt", content: "second", overwrite: true });
  assert.equal(await fs.readFile(path.join(workspace, "pasted-text.txt"), "utf8"), "second");
});

test("imports copy files and folders without overwriting or touching the source", async (context) => {
  const { root, workspace, client } = await createClient(context, "workspace-import");
  const sources = path.join(root, "sources");
  await fs.mkdir(path.join(sources, "pack", "sub"), { recursive: true });
  await fs.writeFile(path.join(sources, "poem.txt"), "poem", "utf8");
  await fs.writeFile(path.join(sources, "pack", "a.txt"), "a", "utf8");
  await fs.writeFile(path.join(sources, "pack", "sub", "b.txt"), "b", "utf8");
  const sourceStatBefore = await fs.stat(path.join(sources, "poem.txt"));

  const first = await client.importWorkspaceItems({
    paths: [path.join(sources, "poem.txt"), path.join(sources, "pack")],
  });
  assert.equal(first.imported.length, 2);
  assert.deepEqual(first.conflicts, []);
  assert.deepEqual(first.blocked, []);
  assert.equal(await fs.readFile(path.join(workspace, "poem.txt"), "utf8"), "poem");
  assert.equal(await fs.readFile(path.join(workspace, "pack", "sub", "b.txt"), "utf8"), "b");

  const second = await client.importWorkspaceItems({
    paths: [path.join(sources, "poem.txt"), path.join(sources, "pack")],
  });
  assert.equal(second.imported.length, 0);
  assert.equal(second.conflicts.length, 2);
  assert.equal(second.conflicts[0].code, "name_conflict");
  assert.equal(await fs.readFile(path.join(workspace, "poem.txt"), "utf8"), "poem");

  const third = await client.importWorkspaceItems({
    paths: [path.join(sources, "poem.txt"), path.join(sources, "pack")],
    conflictPolicy: "keep-both",
  });
  assert.equal(third.imported.length, 2);
  assert.deepEqual(
    third.imported.map((item) => item.relativePath).sort(),
    ["pack (2)", "poem (2).txt"],
  );

  const sourceStatAfter = await fs.stat(path.join(sources, "poem.txt"));
  assert.equal(sourceStatAfter.mtimeMs, sourceStatBefore.mtimeMs, "importing must not modify the source file");
  assert.equal(await fs.readFile(path.join(sources, "poem.txt"), "utf8"), "poem");
});

test("imports refuse symlinks instead of leaving an escape inside the workspace", async (context) => {
  const { root, workspace, client } = await createClient(context, "workspace-import-symlink");
  const sources = path.join(root, "linked-sources");
  await fs.mkdir(sources, { recursive: true });
  await fs.writeFile(path.join(sources, "inner.txt"), "inner", "utf8");
  await fs.symlink(root, path.join(sources, "escape"));

  const result = await client.importWorkspaceItems({ paths: [sources] });
  assert.equal(result.imported.length, 0);
  assert.equal(result.blocked.length, 1);
  assert.equal(result.blocked[0].code, "blocked_symlink");
  assert.deepEqual((await client.listWorkspaceFiles({})).files, []);
  assert.equal(await fs.readFile(path.join(sources, "inner.txt"), "utf8"), "inner");

  await fs.symlink(root, path.join(root, "direct-link"));
  const direct = await client.importWorkspaceItems({ paths: [path.join(root, "direct-link")] });
  assert.equal(direct.blocked[0].code, "blocked_symlink");
  assert.deepEqual((await client.listWorkspaceFiles({})).files, []);
});

test("imports never accept a source that already lives inside the workspace", async (context) => {
  const { workspace, client } = await createClient(context, "workspace-import-self");
  await fs.writeFile(path.join(workspace, "inside.txt"), "inside", "utf8");

  const result = await client.importWorkspaceItems({ paths: [path.join(workspace, "inside.txt")] });
  assert.equal(result.imported.length, 0);
  assert.equal(result.blocked[0].code, "already_in_workspace");
  assert.equal(await fs.readFile(path.join(workspace, "inside.txt"), "utf8"), "inside");
});
