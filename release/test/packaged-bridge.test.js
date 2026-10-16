import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

test("macOS bridge reports bundled browsers and packaged status with isolated user data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-bundled-bridge-"));
  const browsers = path.join(root, "Playwright");
  const require = createRequire(import.meta.url);
  const core = path.dirname(require.resolve("playwright-core/package.json"));
  const manifest = JSON.parse(await fs.readFile(path.join(core, "browsers.json")));
  const revision = manifest.browsers.find((item) => item.name === "chromium").revision;
  const suffix = process.arch === "arm64" ? "chrome-mac-arm64" : "chrome-mac-x64";
  const executable = path.join(browsers, `chromium-${revision}`, suffix, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const bridge = fileURLToPath(new URL("../../apps/macos/swiftui/Runtime/macos-backend.js", import.meta.url));
  const child = spawn(process.execPath, [bridge], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: root, APPDATA: path.join(root, "data"),
      BXB_MACOS_PACKAGED: "1", PLAYWRIGHT_BROWSERS_PATH: browsers },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(async () => {
    child.kill();
    await fs.rm(root, { recursive: true, force: true });
  });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Bridge timed out: ${stderr}`)), 15000);
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const result = JSON.parse(line);
      if (result.id === "1") { clearTimeout(timer); resolve(result); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Bridge exited ${code}: ${stderr}`)); });
  });
  child.stdin.write(`${JSON.stringify({ id: "1", method: "app.info" })}\n`);
  const { ok, result } = await response;
  assert.equal(ok, true);
  assert.equal(result.isPackaged, true);
  assert.equal(result.browserDependency.ready, true);
  assert.equal(result.browserDependency.browserRoot, browsers);
  assert.equal(result.updateChannel, "macOS stable");
  assert.equal(result.userDataRoot, path.join(root, "data/bxb-homework-electron"));
});
