import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = new URL("../scripts/stage-macos-runtime.js", import.meta.url);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-release-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const app = path.join(root, "BXB Homework.app");
  for (const folder of ["backend/src", "backend/bridge", "apps/macos/swiftui/Runtime", ".banxuebang", "backend/test"]) {
    await fs.mkdir(path.join(repo, folder), { recursive: true });
  }
  await fs.mkdir(path.join(app, "Contents/MacOS"), { recursive: true });
  await fs.writeFile(path.join(repo, "package.json"), JSON.stringify({ name: "fixture", version: "0.1.0", type: "module" }));
  await fs.writeFile(path.join(repo, "package-lock.json"), JSON.stringify({ name: "fixture", version: "0.1.0", packages: { "": { version: "0.1.0" } } }));
  await fs.writeFile(path.join(repo, "LICENSE"), "MIT");
  await fs.writeFile(path.join(repo, "backend/src/client.js"), "export const ready = true;");
  await fs.writeFile(path.join(repo, "backend/bridge/winui-backend.js"), "import '../src/client.js';");
  await fs.writeFile(path.join(repo, "apps/macos/swiftui/Runtime/macos-backend.js"), "await import('../../../../backend/bridge/winui-backend.js');");
  await fs.writeFile(path.join(repo, ".banxuebang/session.json"), "secret-session");
  await fs.writeFile(path.join(repo, "backend/test/test.js"), "test-only");
  await fs.writeFile(path.join(repo, ".env"), "SECRET=do-not-ship");
  const node = path.join(root, "node");
  await fs.writeFile(node, "fixture executable", { mode: 0o755 });
  const args = [fileURLToPath(script), "--repo", repo, "--app", app, "--node", node, "--version", "1.2.3"];
  return { repo, app, node, args };
}

test("stages a relocatable runtime and stamps versions without copying user data", async (t) => {
  const { repo, app, args } = await fixture(t);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const runtime = path.join(app, "Contents/Resources/BXBRuntime");
  assert.equal(JSON.parse(await fs.readFile(path.join(runtime, "package.json"))).version, "1.2.3");
  const lock = JSON.parse(await fs.readFile(path.join(runtime, "package-lock.json")));
  assert.equal(lock.version, "1.2.3");
  assert.equal(lock.packages[""].version, "1.2.3");
  assert.equal(JSON.parse(await fs.readFile(path.join(repo, "package.json"))).version, "0.1.0");
  assert.equal(await fs.readFile(path.join(runtime, "backend/src/client.js"), "utf8"), "export const ready = true;");
  await fs.access(path.join(runtime, "Runtime/macos-backend.js"));
  assert.ok((await fs.stat(path.join(app, "Contents/Helpers/node"))).mode & 0o111);
  for (const relative of [".env", ".banxuebang", "backend/test", "apps/macos/swiftui/Runtime/BackendBridgeSmoke.swift"]) {
    await assert.rejects(fs.stat(path.join(runtime, relative)), { code: "ENOENT" });
  }
});

test("refuses to overwrite an existing runtime", async (t) => {
  const { app, args } = await fixture(t);
  const runtime = path.join(app, "Contents/Resources/BXBRuntime");
  await fs.mkdir(runtime, { recursive: true });
  await fs.writeFile(path.join(runtime, "keep.txt"), "keep");
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/);
  assert.equal(await fs.readFile(path.join(runtime, "keep.txt"), "utf8"), "keep");
});

test("rejects invalid versions before changing the app", async (t) => {
  const { app, args } = await fixture(t);
  args[args.length - 1] = "../../escape";
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version/);
  await assert.rejects(fs.stat(path.join(app, "Contents/Resources/BXBRuntime")), { code: "ENOENT" });
});
