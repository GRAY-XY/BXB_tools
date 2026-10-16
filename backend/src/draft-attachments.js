import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_DRAFT_ATTACHMENTS = 20;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const SOURCE_EXTENSIONS = new Set([".py", ".js", ".jsx", ".ts", ".tsx", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".java", ".go", ".rs", ".swift", ".kt", ".rb", ".sh", ".sql"]);

function safeId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9._-]+$/.test(id) || id === "." || id === "..") throw new Error("草稿附件标识无效。");
  return id;
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function attachmentKind(fileName, requested) {
  if (requested && !["source", "image", "file"].includes(requested)) throw new Error("附件类型无效。");
  if (requested) return requested;
  const extension = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) ? "image" : SOURCE_EXTENSIONS.has(extension) ? "source" : "file";
}

export class DraftAttachmentStore {
  constructor(draftDir) {
    this.root = path.resolve(draftDir, "attachments");
  }

  directory(draftId) {
    const directory = path.join(this.root, safeId(draftId));
    if (!inside(this.root, directory)) throw new Error("附件目录必须位于草稿目录内。");
    return directory;
  }

  async checkDirectory(directory) {
    if ((await lstat(this.root)).isSymbolicLink()) throw new Error("草稿附件根目录无效。");
    const root = await realpath(this.root);
    const actual = await realpath(directory);
    if (!inside(root, actual) || (await lstat(directory)).isSymbolicLink()) {
      throw new Error("草稿附件目录无效。");
    }
    return actual;
  }

  async snapshot(draftId, source, { kind, relativePath } = {}) {
    const fileName = path.basename(source);
    const resolvedKind = attachmentKind(fileName, kind);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size > MAX_FILE_BYTES) {
      throw new Error("草稿附件必须是工作区内不超过 25 MB 的普通文件。");
    }
    const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    let buffer;
    try {
      buffer = await handle.readFile();
    } finally { await handle.close(); }
    if (buffer.length > MAX_FILE_BYTES) throw new Error("草稿附件超过 25 MB。");
    const id = randomUUID();
    const attachment = { id, fileName, kind: resolvedKind, sizeBytes: buffer.length,
      sha256: createHash("sha256").update(buffer).digest("hex"), relativePath: relativePath || null };
    try { await this.writeSnapshot(draftId, attachment, buffer); }
    catch (error) { await this.remove(draftId, id).catch(() => {}); throw error; }
    return attachment;
  }

  async writeSnapshot(draftId, attachment, buffer) {
    const draftDirectory = this.directory(draftId);
    await mkdir(draftDirectory, { recursive: true });
    await this.checkDirectory(draftDirectory);
    const fileDirectory = path.join(draftDirectory, safeId(attachment.id));
    await mkdir(fileDirectory, { recursive: true });
    await this.checkDirectory(fileDirectory);
    const fileName = String(attachment.fileName || "");
    if (!fileName || fileName === "." || fileName === ".." || /[\\/]/.test(fileName)) throw new Error("附件文件名无效。");
    try { await writeFile(path.join(fileDirectory, fileName), buffer, { flag: "wx" }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Migration can encounter an already copied attachment; accept only identical bytes.
      await this.read(draftId, attachment);
    }
  }

  async importFrom(sourceStore, draftId, attachment) {
    const { buffer } = await sourceStore.read(draftId, attachment);
    await this.writeSnapshot(draftId, attachment, buffer);
  }

  async read(draftId, attachment) {
    const id = safeId(attachment?.id);
    const fileName = String(attachment?.fileName || "");
    if (!fileName || fileName === "." || fileName === ".." || /[\\/]/.test(fileName)) throw new Error("附件文件名无效。");
    const directory = path.join(this.directory(draftId), id);
    await this.checkDirectory(this.directory(draftId));
    await this.checkDirectory(directory);
    const filePath = path.join(directory, fileName);
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) throw new Error(`附件“${fileName}”不可用。`);
    const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let buffer;
    try { buffer = await handle.readFile(); }
    finally { await handle.close(); }
    const digest = createHash("sha256").update(buffer).digest("hex");
    if (buffer.length !== attachment.sizeBytes || digest !== attachment.sha256) {
      throw new Error(`附件“${fileName}”已发生变化，请重新绑定并审核。`);
    }
    return { ...attachment, path: filePath, buffer };
  }

  async clear(draftId) {
    const directory = this.directory(draftId);
    try { await this.checkDirectory(directory); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    // The resolved target is an owned subdirectory of the attachment root.
    if (!inside(await realpath(this.root), await realpath(directory))) throw new Error("附件清理路径无效。");
    await rm(directory, { recursive: true, force: true });
  }

  async remove(draftId, attachmentId) {
    const directory = path.join(this.directory(draftId), safeId(attachmentId));
    try {
      await this.checkDirectory(this.directory(draftId));
      await this.checkDirectory(directory);
    } catch (error) { if (error.code === "ENOENT") return; throw error; }
    // Both the draft directory and this exact attachment directory were resolved above.
    if (!inside(await realpath(this.root), await realpath(directory))) throw new Error("附件清理路径无效。");
    await rm(directory, { recursive: true, force: true });
  }
}
