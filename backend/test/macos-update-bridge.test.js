import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("native update IPC is user-only, requires confirmation and cannot be called as an assistant tool", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-update-bridge-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [
    { id: "status", method: "macosUpdate.status" },
    { id: "confirm", method: "macosUpdate.prepareInstall", params: { confirmed: false } },
    { id: "agent", method: "tool.call", params: { name: "macosUpdate.download", args: {} } },
  ];
  for (const native of [true, false]) {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL("../bridge/winui-backend.js", import.meta.url))], {
      cwd: root, env: { ...process.env, APPDATA: root, BXB_MACOS_NATIVE: native ? "1" : "0" },
      input: requests.map(r => JSON.stringify(r)).join("\n") + "\n", encoding: "utf8", timeout: 10000,
    });
    assert.equal(child.status, 0, child.stderr);
    const results = new Map(child.stdout.trim().split("\n").map(line => { const r = JSON.parse(line); return [r.id, r]; }));
    assert.equal(results.get("status").ok, native);
    if (native) assert.equal(results.get("status").result.status, "idle");
    assert.equal(results.get("confirm").ok, false);
    assert.equal(results.get("agent").ok, false);
  }
  await assert.rejects(fs.stat(path.join(root, "bxb-homework-electron/updates/macos")), { code: "ENOENT" });
});
