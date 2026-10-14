import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MacOSUpdateManager, selectMacOSRelease } from "../src/macos-updater.js";

const payload = Buffer.from("fixture disk image");
const digest = createHash("sha256").update(payload).digest("hex");
function release(version = "1.2.0", arch = "arm64") {
  const tag = `bxb-homework-swiftui-v${version}`;
  const name = `BXBHomework-v${version}-macos-${arch}.dmg`;
  const url = `https://github.com/GRAY-XY/BXB_tools/releases/download/${tag}/`;
  return { tag_name: tag, name: `BXB Homework SwiftUI v${version}`, draft: false, prerelease: false,
    assets: [{ name, size: payload.length, browser_download_url: url + name, digest: `sha256:${digest}` },
      { name: `${name}.sha256`, size: 120, browser_download_url: `${url}${name}.sha256` }] };
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-update-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidate = release();
  const requests = [];
  const manager = new MacOSUpdateManager({ cacheDir: path.join(root, "cache"), fetchImpl: async (url, init) => {
    requests.push(url);
    if (url.includes("api.github.com")) return Response.json([candidate]);
    if (url.endsWith(".sha256")) return new Response(options.checksum ?? `${digest}  ${candidate.assets[0].name}\n`);
    if (options.download) return options.download(init);
    return new Response(options.bytes ?? payload);
  } });
  await manager.check({ currentVersion: "1.0.0", architecture: "arm64" });
  return { root, manager, candidate, requests, target: path.join(root, "cache", candidate.assets[0].name) };
}

test("selects numeric native stable versions and matching architectures, ignoring other channels", () => {
  const drafts = release("9.0.0"); drafts.draft = true;
  const preview = release("8.0.0"); preview.prerelease = true;
  const windows = release("7.0.0"); windows.tag_name = "bxb-homework-v7.0.0";
  const candidates = [release("1.9.0"), release("1.10.0"), drafts, preview, windows, release("2.0.0", "x86_64")];
  assert.equal(selectMacOSRelease(candidates, "1.0.0", "arm64").release.tag_name, "bxb-homework-swiftui-v1.10.0");
  assert.equal(selectMacOSRelease(candidates, "1.0.0", "x86_64").latestVersion, "2.0.0");
  assert.equal(selectMacOSRelease(candidates, "2.0.0", "arm64").reason, "up_to_date");
});

test("missing compatible assets, checksum sidecars and untrusted URLs cannot offer a download", () => {
  assert.equal(selectMacOSRelease([release("2.0.0", "x86_64")], "1.0.0", "arm64").reason, "no_compatible_artifact");
  const noHash = release(); noHash.assets.pop();
  assert.equal(selectMacOSRelease([noHash], "1.0.0", "arm64").reason, "no_compatible_artifact");
  const foreign = release(); foreign.assets[0].browser_download_url = "https://example.com/package.dmg";
  assert.equal(selectMacOSRelease([foreign], "1.0.0", "arm64").reason, "no_compatible_artifact");
  assert.equal(selectMacOSRelease([], "1.0.0", "arm64").reason, "no_release");
});

test("checking fetches only release metadata; installation requires confirmation and a reverified download", async (t) => {
  const f = await fixture(t);
  assert.equal(f.requests.length, 1);
  assert.equal(f.manager.status().canInstall, false);
  await assert.rejects(f.manager.prepareInstall({ confirmed: true }));
  const ready = await f.manager.download();
  assert.equal(ready.status, "ready");
  assert.equal(ready.verified, true);
  assert.equal(ready.canInstall, true);
  assert.equal(ready.filePath, undefined);
  assert.equal(ready.percent, 100);
  assert.deepEqual(await fs.readFile(f.target), payload);
  assert.equal((await fs.stat(f.target)).mode & 0o777, 0o600);
  await assert.rejects(f.manager.prepareInstall({ confirmed: false }), /确认/);
  assert.equal((await f.manager.prepareInstall({ confirmed: true })).filePath, f.target);
  await fs.writeFile(f.target, "tampered");
  await assert.rejects(f.manager.prepareInstall({ confirmed: true }), /校验/);
  assert.equal(f.manager.status().canInstall, false);
});

test("corrupt, truncated and mismatched checksum downloads leave no installable cache file", async (t) => {
  for (const options of [{ bytes: Buffer.from("corrupt") }, { checksum: `${digest}  wrong.dmg\n` },
    { checksum: `${"0".repeat(64)}  ${release().assets[0].name}\n` }]) {
    const f = await fixture(t, options);
    assert.equal((await f.manager.download()).status, "failed");
    assert.equal(f.manager.status().verified, false);
    assert.equal(f.manager.status().canInstall, false);
    assert.deepEqual(await fs.readdir(path.join(f.root, "cache")), []);
  }
});

test("reports byte progress, cancels the real partial file and permits a retry", async (t) => {
  let responseCount = 0;
  const f = await fixture(t, { download: (init) => {
    if (++responseCount > 1) return new Response(payload);
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(payload.subarray(0, 4));
        init.signal.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
      },
    }));
  } });
  const downloading = f.manager.download();
  for (let i = 0; i < 100 && f.manager.status().downloadedBytes < 4; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.manager.status().downloadedBytes, 4);
  assert.equal(f.manager.status().canInstall, false);
  f.manager.cancel();
  assert.equal((await downloading).status, "cancelled");
  assert.deepEqual(await fs.readdir(path.join(f.root, "cache")), []);
  assert.equal((await f.manager.download()).status, "ready");
});

test("a cache symlink cannot be opened as a verified installer", async (t) => {
  const f = await fixture(t);
  await f.manager.download();
  const outside = path.join(f.root, "outside.dmg");
  await fs.writeFile(outside, payload);
  await fs.unlink(f.target);
  await fs.symlink(outside, f.target);
  await assert.rejects(f.manager.prepareInstall({ confirmed: true }), /校验/);
  assert.equal(f.manager.status().canInstall, false);
  assert.deepEqual(await fs.readFile(outside), payload);
});

test("a replaced cache directory cannot redirect confirmed installer handoff", async (t) => {
  const f = await fixture(t);
  await f.manager.download();
  await fs.rename(path.join(f.root, "cache"), path.join(f.root, "original-cache"));
  const outside = path.join(f.root, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, f.candidate.assets[0].name), payload);
  await fs.symlink(outside, path.join(f.root, "cache"));
  await assert.rejects(f.manager.prepareInstall({ confirmed: true }), /校验/);
  assert.equal(f.manager.status().canInstall, false);
});

test("a failed release request and an invalid installed version are retryable without downloading", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-update-check-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let requests = 0;
  const manager = new MacOSUpdateManager({ cacheDir: root, fetchImpl: async () => {
    return ++requests === 1 ? new Response("Unavailable", { status: 503 }) : Response.json([release()]);
  } });
  assert.equal((await manager.check({ currentVersion: "bad", architecture: "arm64" })).status, "failed");
  assert.equal(requests, 0);
  assert.equal((await manager.check({ currentVersion: "1.0.0", architecture: "arm64" })).status, "failed");
  assert.equal(manager.status().canDownload, false);
  assert.equal((await manager.check({ currentVersion: "1.0.0", architecture: "arm64" })).status, "available");
  assert.equal(requests, 2);
});
