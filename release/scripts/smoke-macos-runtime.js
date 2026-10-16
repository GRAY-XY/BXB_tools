import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

// This script runs with the bundled Node, not a developer's interpreter.
const app = await fs.realpath(process.argv[2]);
const runtime = path.join(app, "Contents/Resources/BXBRuntime");
const browsers = path.join(app, "Contents/Resources/Playwright");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-runtime-smoke-"));
const child = spawn(process.execPath, [path.join(runtime, "Runtime/macos-backend.js")], {
  cwd: root,
  env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: root, APPDATA: path.join(root, "data"),
    BXB_RUNTIME_ROOT: runtime, BXB_MACOS_PACKAGED: "1", PLAYWRIGHT_BROWSERS_PATH: browsers },
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (data) => { stderr += data; });
const pending = new Map();
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  const response = JSON.parse(line);
  const request = pending.get(response.id);
  if (!request) return;
  pending.delete(response.id);
  clearTimeout(request.timer);
  if (response.ok) request.resolve(response.result);
  else request.reject(new Error(JSON.stringify(response.error)));
});
child.on("error", (error) => { for (const request of pending.values()) request.reject(error); });
child.on("exit", (code) => {
  for (const request of pending.values()) request.reject(new Error(`Backend exited ${code}: ${stderr}`));
});
let nextID = 0;
function invoke(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++nextID);
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Backend timed out: ${stderr}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}

let browser;
try {
  const info = await invoke("app.info");
  assert.equal(info.isPackaged, true);
  assert.equal(info.payloadRoot, runtime);
  assert.equal(info.browserDependency.ready, true);
  assert.equal(info.browserDependency.browserRoot, browsers);
  assert.equal(info.version, JSON.parse(await fs.readFile(path.join(runtime, "package.json"))).version);
  assert.equal(info.userDataRoot, path.join(root, "data/bxb-homework-electron"));
  const session = await invoke("session.status");
  assert.notEqual(session.ready, true);
  await invoke("tool.call", { name: "write_workspace_text_file", args: { file_name: "release-smoke.txt", content: "bundled runtime works" } });
  assert.equal(await fs.readFile(path.join(info.workspaceDir, "release-smoke.txt"), "utf8"), "bundled runtime works");

  process.env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  const { chromium } = await import(pathToFileURL(path.join(runtime, "node_modules/playwright/index.mjs")));
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const page = await browser.newPage();
  await page.setContent("<title>BXB packaged browser</title>");
  assert.equal(await page.title(), "BXB packaged browser");
  console.log(`runtime-smoke=ok platform=${process.platform} arch=${process.arch} version=${info.version}`);
} finally {
  await browser?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
  await fs.rm(root, { recursive: true, force: true });
}
