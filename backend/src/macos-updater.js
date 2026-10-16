import { createHash, randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPOSITORY = "https://github.com/GRAY-XY/BXB_tools";
const RELEASES_API = "https://api.github.com/repos/GRAY-XY/BXB_tools/releases";
const MAX_IMAGE_BYTES = 2 * 1024 ** 3;
const versionParts = value => /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value || "")
  ? value.split(".").map(Number) : null;
function compare(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function selectMacOSRelease(releases, currentVersion, architecture) {
  if (!versionParts(currentVersion) || !["arm64", "x86_64"].includes(architecture)) {
    throw new Error("无法读取当前应用版本或处理器类型。");
  }
  const candidates = (Array.isArray(releases) ? releases : []).flatMap(release => {
    if (release.draft || release.prerelease) return [];
    const version = /^bxb-homework-swiftui-v(.+)$/.exec(release.tag_name || "")?.[1];
    return versionParts(version) ? [{ release, version }] : [];
  }).sort((a, b) => compare(b.version, a.version));
  if (!candidates.length) return { reason: "no_release", latestVersion: null, release: null };
  if (compare(candidates[0].version, currentVersion) <= 0) {
    return { reason: "up_to_date", latestVersion: candidates[0].version, release: null };
  }
  for (const { release, version } of candidates) {
    if (compare(version, currentVersion) <= 0) break;
    const name = `BXBHomework-v${version}-macos-${architecture}.dmg`;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const prefix = `${REPOSITORY}/releases/download/${release.tag_name}/`;
    const image = assets.find(asset => asset.name === name && asset.browser_download_url === prefix + name);
    const checksum = assets.find(asset => asset.name === `${name}.sha256` && asset.browser_download_url === `${prefix}${name}.sha256`);
    if (!image || !checksum || !Number.isSafeInteger(image.size) || image.size <= 0 || image.size > MAX_IMAGE_BYTES
      || (image.state && image.state !== "uploaded") || (checksum.state && checksum.state !== "uploaded")) continue;
    return { reason: "available", latestVersion: version, release, image, checksum };
  }
  return { reason: "no_compatible_artifact", latestVersion: candidates[0].version, release: null };
}

async function boundedText(response, limit) {
  if (!response.ok || !response.body) throw new Error("更新服务暂不可用，请稍后重试。");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error("更新服务返回的数据过大。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function hashRegularFile(file) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Invalid installer");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    const named = await fs.lstat(file);
    if (named.isSymbolicLink() || before.ino !== named.ino || before.dev !== named.dev
      || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Installer changed");
    return { hash: hash.digest("hex"), size: after.size };
  } finally { await handle.close(); }
}

export class MacOSUpdateManager {
  constructor({ cacheDir, fetchImpl = fetch }) {
    this.cacheDir = path.resolve(cacheDir);
    this.fetch = fetchImpl;
    this.active = null;
    this.candidate = null;
    this.expectedHash = null;
    this.file = null;
    this.state = { status: "idle", currentVersion: null, latestVersion: null, message: "点击检查更新。",
      downloadedBytes: 0, totalBytes: 0, percent: 0, verified: false, latestNotes: "", releaseUrl: null };
  }

  status() {
    return { ...this.state,
      canDownload: Boolean(this.candidate && ["available", "failed", "cancelled"].includes(this.state.status)),
      canInstall: this.state.status === "ready" && this.state.verified === true,
    };
  }

  patch(values) { Object.assign(this.state, values); return this.status(); }

  async check({ currentVersion, architecture }) {
    if (this.active) return this.status();
    const controller = new AbortController();
    this.active = controller;
    this.candidate = null;
    this.file = null;
    this.expectedHash = null;
    this.patch({ status: "checking", currentVersion, latestVersion: null, verified: false,
      downloadedBytes: 0, totalBytes: 0, percent: 0, message: "正在检查更新…", latestNotes: "", releaseUrl: null });
    try {
      if (!versionParts(currentVersion) || !["arm64", "x86_64"].includes(architecture)) throw new Error("无法读取当前应用版本或处理器类型。");
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]);
      const releases = [];
      for (let page = 1; page <= 10; page++) {
        const response = await this.fetch(`${RELEASES_API}?per_page=100&page=${page}`, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": "BXB-Homework-SwiftUI" }, signal,
        });
        const batch = JSON.parse(await boundedText(response, 2 * 1024 ** 2));
        if (!Array.isArray(batch)) throw new Error("Invalid release response");
        releases.push(...batch);
        if (batch.length < 100) break;
      }
      if (signal.aborted) throw new Error("Cancelled");
      const selected = selectMacOSRelease(releases, currentVersion, architecture);
      this.candidate = selected.release ? selected : null;
      const messages = { available: `发现新版本 ${selected.latestVersion}。`, up_to_date: "当前已是最新版本。",
        no_release: "暂无 SwiftUI 正式发布版本。", no_compatible_artifact: "新版本暂无适用于这台 Mac 且提供校验文件的安装包。" };
      return this.patch({ status: selected.reason === "available" ? "available" : selected.reason === "up_to_date" ? "up_to_date" : "unavailable",
        latestVersion: selected.latestVersion, message: messages[selected.reason],
        latestNotes: String(selected.release?.body || "").slice(0, 4000),
        releaseUrl: selected.release ? `${REPOSITORY}/releases/tag/${selected.release.tag_name}` : null });
    } catch {
      return this.patch({ status: controller.signal.aborted ? "cancelled" : "failed",
        message: controller.signal.aborted ? "已取消检查。" : "检查更新失败，请检查网络后重试。" });
    } finally { this.active = null; }
  }

  async download() {
    if (this.active || !this.status().canDownload) return this.status();
    const candidate = this.candidate;
    const controller = new AbortController();
    this.active = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60 * 1000)]);
    const partial = path.join(this.cacheDir, `${randomUUID()}.partial`);
    const target = path.join(this.cacheDir, candidate.image.name);
    let renamed = false;
    let verificationStarted = false;
    this.patch({ status: "downloading", message: "正在下载更新…", verified: false,
      downloadedBytes: 0, totalBytes: candidate.image.size, percent: 0 });
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const cache = await fs.lstat(this.cacheDir);
      if (!cache.isDirectory() || cache.isSymbolicLink()) throw new Error("Invalid cache");
      const checksum = await boundedText(await this.fetch(candidate.checksum.browser_download_url, { signal }), 16384);
      const hashes = checksum.split(/\r?\n/).flatMap(line => {
        const match = /^([a-f\d]{64})[ \t]+\*?(.+)$/i.exec(line);
        return match?.[2] === candidate.image.name ? [match[1].toLowerCase()] : [];
      });
      if (hashes.length !== 1 || (candidate.image.digest && candidate.image.digest !== `sha256:${hashes[0]}`)) {
        verificationStarted = true;
        throw new Error("Invalid checksum");
      }
      const response = await this.fetch(candidate.image.browser_download_url, { signal });
      if (!response.ok || !response.body) throw new Error("Download failed");
      const hash = createHash("sha256");
      let bytes = 0;
      await pipeline(Readable.fromWeb(response.body), new Transform({ transform: (chunk, encoding, callback) => {
        bytes += chunk.length;
        if (bytes > candidate.image.size) { callback(new Error("Oversized image")); return; }
        hash.update(chunk);
        this.patch({ downloadedBytes: bytes, percent: Math.min(99, bytes / candidate.image.size * 100) });
        callback(null, chunk);
      } }), createWriteStream(partial, { flags: "wx", mode: 0o600 }), { signal });
      verificationStarted = true;
      this.patch({ status: "verifying", message: "正在校验安装包…" });
      if (bytes !== candidate.image.size || hash.digest("hex") !== hashes[0]) throw new Error("Checksum mismatch");
      if (signal.aborted) throw new Error("Cancelled");
      await fs.rename(partial, target);
      renamed = true;
      if (signal.aborted) throw new Error("Cancelled");
      this.expectedHash = hashes[0];
      this.file = target;
      return this.patch({ status: "ready", verified: true, percent: 100, message: "更新已下载并通过校验，等待你确认安装。" });
    } catch {
      if (renamed) await fs.unlink(target).catch(() => {});
      this.file = null;
      this.expectedHash = null;
      return this.patch({ status: controller.signal.aborted ? "cancelled" : "failed", verified: false,
        message: controller.signal.aborted ? "下载已取消。" : verificationStarted ? "更新安装包校验失败，请重新下载。" : "下载更新失败，请检查网络和磁盘空间后重试。" });
    } finally {
      await fs.unlink(partial).catch(() => {});
      this.active = null;
    }
  }

  cancel() {
    if (this.active) this.active.abort();
    return this.status();
  }

  async prepareInstall({ confirmed } = {}) {
    if (confirmed !== true) throw new Error("请先确认打开安装包并退出应用。");
    if (!this.status().canInstall || !this.file || !this.expectedHash || this.active) throw new Error("没有已校验的更新安装包。");
    try {
      const cache = await fs.lstat(this.cacheDir);
      if (!cache.isDirectory() || cache.isSymbolicLink()) throw new Error("Invalid cache");
      const verified = await hashRegularFile(this.file);
      const after = await fs.lstat(this.cacheDir);
      if (after.isSymbolicLink() || cache.ino !== after.ino || cache.dev !== after.dev) throw new Error("Cache changed");
      if (verified.hash !== this.expectedHash || verified.size !== this.candidate.image.size) throw new Error("Installer changed");
      return { ...this.status(), filePath: this.file };
    } catch {
      this.patch({ status: "failed", verified: false, message: "安装包校验失败，请重新下载。" });
      throw new Error("安装包校验失败，请重新下载。");
    }
  }
}
