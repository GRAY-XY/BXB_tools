import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright";
import { DraftStore } from "./draft-store.js";

const BASE_URL = "https://student.banxuebang.com";
const BASIC_AUTH = "Basic YnhiLXdlYi1zOmJ4Yi13ZWItcw==";
const STORAGE_KEYS = [
  "tokens",
  "userInfo",
  "curClass",
  "currTermId",
  "curSubject",
  "subjectList",
  "termList",
  "menuData",
  "topMenuArray",
  "deviceId",
  "loginName",
];
const TEXT_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".json",
  ".log",
  ".md",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".text",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".avi", ".m4v", ".mov", ".mp4", ".mkv", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"]);
const ALL_SUBJECT_ID = "__all_courses__";
const ALL_SUBJECT_NAMES = new Set(["全部课程", "全部", "all", "all courses"]);
const WEB_SEARCH_ENGINES = new Set(["bing"]);

function defaultWorkspaceDir() {
  return process.env.BANXUEBANG_WORKSPACE_DIR || path.join(process.cwd(), ".banxuebang", "workspace");
}

function buildAllSubject() {
  return {
    id: ALL_SUBJECT_ID,
    classId: null,
    name: "全部课程",
    cnName: "全部课程",
    allSubjects: true,
    unSubmitCount: null,
  };
}

function isAllSubject(subject) {
  return Boolean(subject?.allSubjects || normalizeId(subject?.id) === ALL_SUBJECT_ID);
}

function isAllSubjectName(value) {
  return ALL_SUBJECT_NAMES.has(normalizeName(value));
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value ?? null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyStorageValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "string" ? value : JSON.stringify(value);
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeId(value) {
  return value === null || value === undefined ? null : String(value);
}

function findById(items, id, extraMatch) {
  const targetId = normalizeId(id);
  if (!targetId) {
    return null;
  }

  return (
    items.find((item) => {
      if (normalizeId(item.id) !== targetId) {
        return false;
      }

      return extraMatch ? extraMatch(item) : true;
    }) || null
  );
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function findByName(items, name, selectors = [], extraMatch) {
  const targetName = normalizeName(name);
  if (!targetName) {
    return null;
  }

  const getCandidateNames = (item) =>
    selectors
      .map((selector) => selector(item))
      .filter(Boolean)
      .map((value) => String(value).trim());

  const exactMatch =
    items.find((item) => {
      if (extraMatch && !extraMatch(item)) {
        return false;
      }

      return getCandidateNames(item).some((candidate) => normalizeName(candidate) === targetName);
    }) || null;

  if (exactMatch) {
    return exactMatch;
  }

  return (
    items.find((item) => {
      if (extraMatch && !extraMatch(item)) {
        return false;
      }

      return getCandidateNames(item).some((candidate) =>
        normalizeName(candidate).includes(targetName),
      );
    }) || null
  );
}

function maskToken(token) {
  if (!token) {
    return null;
  }

  if (token.length <= 12) {
    return `${token.slice(0, 3)}***${token.slice(-2)}`;
  }

  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function safeBusinessResult(result, endpoint) {
  if (result && typeof result === "object" && "code" in result && result.code) {
    const message = result.msg || result.message || `Business error on ${endpoint}`;
    throw new Error(message);
  }

  return result;
}

function parseStorageMap(storage) {
  return {
    tokens: parseMaybeJson(storage.tokens),
    userInfo: parseMaybeJson(storage.userInfo),
    curClass: parseMaybeJson(storage.curClass),
    currTermId: parseMaybeJson(storage.currTermId),
    curSubject: parseMaybeJson(storage.curSubject),
    subjectList: parseMaybeJson(storage.subjectList) || [],
    termList: parseMaybeJson(storage.termList) || [],
    menuData: parseMaybeJson(storage.menuData) || [],
    topMenuArray: parseMaybeJson(storage.topMenuArray) || [],
    loginName: parseMaybeJson(storage.loginName),
    deviceId: parseMaybeJson(storage.deviceId),
  };
}

function buildStorageFromContext(storage = {}, context = {}, auth = {}) {
  return {
    ...storage,
    tokens: stringifyStorageValue(auth),
    userInfo: stringifyStorageValue(context.userInfo),
    curClass: stringifyStorageValue(context.curClass),
    currTermId:
      context.currTermId === null || context.currTermId === undefined
        ? null
        : String(context.currTermId),
    curSubject: stringifyStorageValue(context.curSubject),
    subjectList: stringifyStorageValue(context.subjectList || []),
    termList: stringifyStorageValue(context.termList || []),
    loginName:
      context.loginName === null || context.loginName === undefined
        ? storage.loginName ?? null
        : String(context.loginName),
    deviceId:
      context.deviceId === null || context.deviceId === undefined
        ? storage.deviceId ?? null
        : String(context.deviceId),
  };
}

function computeCountdown(endTime) {
  if (!endTime) {
    return { isEnd: false, days: null, hours: null, emergentType: null };
  }

  const end = new Date(String(endTime).replaceAll("-", "/"));
  if (Number.isNaN(end.getTime())) {
    return { isEnd: false, days: null, hours: null, emergentType: null };
  }

  const now = new Date();
  if (now >= end) {
    return { isEnd: true, days: "00", hours: "00", emergentType: null };
  }

  const diff = end.getTime() - now.getTime();
  const daysNum = Math.floor(diff / 86400000);
  const hoursNum = Math.floor((diff % 86400000) / 3600000);
  const days = daysNum < 10 ? `0${daysNum}` : String(daysNum);
  const hours = hoursNum < 10 ? `0${hoursNum}` : String(hoursNum);
  const normalizedHours = days === "00" && hours === "00" ? "01" : hours;

  let emergentType = 1;
  if (daysNum >= 2) {
    emergentType = 3;
  } else if (daysNum >= 1) {
    emergentType = 2;
  }

  return {
    isEnd: false,
    days,
    hours: normalizedHours,
    emergentType,
  };
}

async function launchBrowser(headless) {
  const browserRootCandidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local", "ms-playwright") : null,
  ].filter(Boolean);
  const executableCandidates = browserRootCandidates.flatMap((browserRoot) => [
    path.join(browserRoot, "chromium-1217", "chrome-win64", "chrome.exe"),
    path.join(browserRoot, "chromium-1217", "chrome-win", "chrome.exe"),
  ]);
  const executablePath = executableCandidates.find((candidate) => existsSync(candidate));

  try {
    const launchOptions = {
      headless,
    };
    if (executablePath) {
      launchOptions.executablePath = executablePath;
    } else {
      launchOptions.channel = "chromium";
    }
    return await chromium.launch(launchOptions);
  } catch (error) {
    throw new Error(
      `Failed to launch Playwright Chromium. Install the browser payload or extract ms-playwright-browsers.zip to the Playwright cache. Checked: ${executableCandidates.join(", ")}. Original error: ${error.message}`,
    );
  }
}

function enrichHomeworkRecord(item) {
  const countdown = computeCountdown(item.endTime);
  return { ...item, ...countdown };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function decodeHtmlEntities(value) {
  if (!value) {
    return "";
  }

  return String(value)
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function stripHtml(value) {
  if (!value) {
    return "";
  }

  return decodeHtmlEntities(
    String(value)
      .replaceAll(/<br\s*\/?>/gi, "\n")
      .replaceAll(/<\/p>/gi, "\n")
      .replaceAll(/<[^>]+>/g, " ")
      .replaceAll(/\r/g, "")
      .replaceAll(/[ \t]+\n/g, "\n")
      .replaceAll(/\n{3,}/g, "\n\n")
      .replaceAll(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function buildTextPreview(text, maxChars = 4000) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return {
      text: "",
      truncated: false,
      totalChars: 0,
    };
  }

  return {
    text: normalized.slice(0, maxChars),
    truncated: normalized.length > maxChars,
    totalChars: normalized.length,
  };
}

function sanitizeFileName(fileName, fallback = "attachment") {
  const cleaned = String(fileName || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();

  return cleaned || fallback;
}

function sanitizeWorkspaceFileName(fileName, fallback = "workspace-file.txt") {
  const cleaned = sanitizeFileName(path.basename(String(fileName || "")), fallback);
  return cleaned === "." || cleaned === ".." ? fallback : cleaned;
}

function summarizeLocalFile(filePath, workspaceDir, fileStat) {
  const relativePath = path.relative(workspaceDir, filePath).replaceAll("\\", "/");
  const extension = path.extname(filePath).toLowerCase();
  return {
    name: path.basename(filePath),
    relativePath,
    path: filePath,
    extension,
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    category: IMAGE_EXTENSIONS.has(extension)
      ? "image"
      : VIDEO_EXTENSIONS.has(extension)
        ? "video"
        : AUDIO_EXTENSIONS.has(extension)
          ? "audio"
          : extension === ".pdf"
            ? "pdf"
            : extension === ".docx"
              ? "docx"
              : TEXT_FILE_EXTENSIONS.has(extension)
                ? "text"
                : "file",
  };
}

function parseDispositionFilename(contentDisposition) {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const asciiMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return asciiMatch?.[1] || null;
}

function getFileExtension(fileName, explicitExt = null) {
  if (explicitExt) {
    const normalized = String(explicitExt).trim();
    return normalized.startsWith(".") ? normalized.toLowerCase() : `.${normalized.toLowerCase()}`;
  }

  return path.extname(String(fileName || "")).toLowerCase();
}

function guessAttachmentCategory(file) {
  const extension = getFileExtension(
    file?.fileName || file?.filename || file?.name,
    file?.fileExt || file?.ext,
  );
  const mimeType = String(file?.fileType || file?.contenttype || "").toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension) || mimeType.startsWith("image/")) {
    return 1;
  }

  if (VIDEO_EXTENSIONS.has(extension) || mimeType.startsWith("video/")) {
    return 2;
  }

  if (AUDIO_EXTENSIONS.has(extension) || mimeType.startsWith("audio/")) {
    return 3;
  }

  return 4;
}

function normalizeAttachment(file, source = "task") {
  if (!file || typeof file !== "object") {
    return null;
  }

  const raw = file.correctAttachment && typeof file.correctAttachment === "object"
    ? { ...file, ...file.correctAttachment }
    : file;
  const fileId = normalizeId(raw.fileId || raw.correctFileId || raw.id);

  if (!fileId) {
    return null;
  }

  const fileName =
    raw.fileName || raw.filename || raw.name || raw.originalFileName || `${fileId}`;
  const fileExt = getFileExtension(fileName, raw.fileExt || raw.ext);

  return {
    fileId,
    source,
    name: raw.name || raw.fileName || raw.filename || fileName,
    fileName,
    fileExt,
    fileType: raw.fileType || raw.contenttype || raw.mimeType || null,
    fileSize: raw.fileSize || raw.filesize || null,
    category: raw.category || guessAttachmentCategory(raw),
    creatorId: raw.creatorId || raw.userid || null,
    createTime: raw.createTime || raw.uploaddate || null,
    raw,
  };
}

function collectAttachments(files, source) {
  return toArray(files)
    .map((file) => normalizeAttachment(file, source))
    .filter(Boolean);
}

function summarizeCourse(course) {
  return {
    id: normalizeId(course.id),
    classId: normalizeId(course.classId),
    name: course.cnName || course.name || null,
    color: course.color || null,
    teacherList: toArray(course.teacherList),
    unSubmitCount: course.unSubmitCount ?? 0,
  };
}

function summarizeTask(task) {
  if (!task || typeof task !== "object") {
    return null;
  }

  return {
    id: normalizeId(task.id || task.activityId),
    activityName: task.activityName || null,
    courseName: task.courseName || null,
    classId: normalizeId(task.classId),
    createName: task.createName || null,
    releaseTime: task.releaseTime || null,
    endTime: task.endTime || null,
    scoreTypeName: task.scoreTypeName || null,
    scoreTypeColor: task.scoreTypeColor || null,
    scoreCategory: task.scoreCategory ?? null,
    homeworkType: task.homeworkType ?? null,
    isParticipate: task.isParticipate ?? null,
    correction: task.correction ?? null,
    lastAwcId: normalizeId(task.lastAwcId),
  };
}

function clampInt(value, fallback, { min = 1, max = 20 } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function normalizeSearchEngine(engine) {
  const normalized = String(engine || "bing").trim().toLowerCase();
  if (!WEB_SEARCH_ENGINES.has(normalized)) {
    throw new Error(`Unsupported search engine "${engine}". Supported engines: bing.`);
  }
  return normalized;
}

function normalizeHttpUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`Invalid URL "${value}".`);
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs can be opened.");
  }
  return url.toString();
}

function extractXmlTag(xml, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(xml || "").match(pattern);
  if (!match) {
    return "";
  }

  return decodeHtmlEntities(
    match[1]
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .trim(),
  );
}

function parseBingRssResults(xml, maxResults) {
  return Array.from(String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi))
    .map((match) => {
      const itemXml = match[1];
      const title = stripHtml(extractXmlTag(itemXml, "title"));
      const url = extractXmlTag(itemXml, "link").trim();
      const snippet = stripHtml(extractXmlTag(itemXml, "description"));
      const publishedAt = extractXmlTag(itemXml, "pubDate").trim() || null;
      return { title, url, snippet, publishedAt };
    })
    .filter((item) => item.title && /^https?:\/\//i.test(item.url))
    .slice(0, maxResults);
}

async function listFilesRecursive(rootDir, { maxFiles = 200, currentDir = rootDir } = {}) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (files.length >= maxFiles) {
      break;
    }

    if (entry.name.startsWith(".")) {
      continue;
    }

    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(rootDir, {
        maxFiles: maxFiles - files.length,
        currentDir: entryPath,
      });
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

function getPrivateMessagePeer(contact) {
  if (!contact || typeof contact !== "object") {
    return {};
  }

  const selfIsReceiver = contact.receiverType === "S";
  return {
    id: normalizeId(selfIsReceiver ? contact.senderId : contact.receiverId),
    name: selfIsReceiver ? contact.senderName : contact.receiverName,
    type: selfIsReceiver ? contact.senderType : contact.receiverType,
    avatar: selfIsReceiver ? contact.senderAvatar : contact.receiverAvatar,
    sexCode: selfIsReceiver ? contact.senderSexCode : contact.receiverSexCode,
  };
}

function summarizePrivateContact(contact) {
  const peer = getPrivateMessagePeer(contact);
  return {
    id: normalizeId(contact.id),
    classId: normalizeId(contact.classId),
    className: contact.className || null,
    peerId: peer.id,
    peerName: peer.name || null,
    peerType: peer.type || null,
    peerAvatar: peer.avatar || null,
    peerSexCode: peer.sexCode ?? null,
    receiverId: normalizeId(contact.receiverId),
    receiverType: contact.receiverType || null,
    senderId: normalizeId(contact.senderId),
    senderType: contact.senderType || null,
    childId: normalizeId(contact.childId) || "",
    kinship: contact.kinship || "",
    unreadNum: contact.unreadNum ?? 0,
    lastTime: contact.lastTime || null,
    lastContent: contact.lastContent || "",
    courseName: contact.courseName || null,
    courseColor: contact.courseColor || null,
  };
}

function summarizePrivateMessage(message) {
  return {
    id: normalizeId(message.id),
    classId: normalizeId(message.classId),
    className: message.className || null,
    receiverId: normalizeId(message.receiverId),
    receiverName: message.receiverName || null,
    receiverType: message.receiverType || null,
    senderId: normalizeId(message.senderId),
    senderName: message.senderName || null,
    senderType: message.senderType || null,
    content: message.content || "",
    contentType: message.contentType || "T",
    readFlag: message.readFlag ?? null,
    revocation: message.revocation ?? 0,
    createTime: message.createTime || null,
  };
}

function parseTextBuffer(buffer, extension) {
  const text = buffer.toString("utf8");
  if (extension === ".html" || extension === ".htm") {
    return stripHtml(text);
  }

  return text;
}

export class BanxuebangClient {
  constructor(store, draftStore = new DraftStore()) {
    this.store = store;
    this.draftStore = draftStore;
  }

  async getSession() {
    return this.store.load();
  }

  summarizeSession(session) {
    if (!session) {
      return {
        ready: false,
        baseUrl: BASE_URL,
        sessionFile: this.store.sessionFile,
      };
    }

    const context = ensureObject(session.context);
    const currentSubject = ensureObject(context.curSubject);
    const currentClass = ensureObject(context.curClass);
    const userInfo = ensureObject(context.userInfo);

    return {
      ready: Boolean(session.auth?.access_token && userInfo.id),
      baseUrl: session.baseUrl || BASE_URL,
      sessionFile: this.store.sessionFile,
      capturedAt: session.capturedAt || null,
      loginSource: session.source || null,
      accessToken: maskToken(session.auth?.access_token),
      refreshToken: maskToken(session.auth?.refresh_token),
      user: userInfo.id
        ? {
            id: userInfo.id,
            name: userInfo.userName || userInfo.realName || null,
            loginName: context.loginName || null,
          }
        : null,
      currentClass: currentClass.id
        ? {
            id: currentClass.id,
            name: currentClass.className || currentClass.name || null,
            campusId: currentClass.campusId || null,
          }
        : null,
      currentTermId: context.currTermId || null,
      currentSubject: currentSubject.id
        ? {
            id: currentSubject.id,
            classId: currentSubject.classId || null,
            name: currentSubject.cnName || currentSubject.name || null,
            allSubjects: Boolean(currentSubject.allSubjects),
            unSubmitCount: currentSubject.unSubmitCount ?? null,
          }
        : null,
      availableTerms: (context.termList || []).map((term) => ({
        id: term.id,
        name: term.name || term.termName || null,
        status: term.status ?? null,
      })),
      availableSubjects: (context.subjectList || []).map((subject) => ({
        id: subject.id,
        classId: subject.classId || null,
        name: subject.cnName || subject.name || null,
        color: subject.color || null,
        unSubmitCount: subject.unSubmitCount ?? null,
      })),
    };
  }

  async requireSession() {
    const session = await this.getSession();
    if (!session || !session.auth?.access_token || !session.context?.userInfo?.id) {
      throw new Error(
        "No usable Banxuebang session found. Run interactive_login or import_browser_storage first.",
      );
    }

    return session;
  }

  workspaceDir() {
    return defaultWorkspaceDir();
  }

  async ensureWorkspaceDir() {
    const workspaceDir = this.workspaceDir();
    await mkdir(workspaceDir, { recursive: true });
    return workspaceDir;
  }

  async resolveWorkspaceFile(fileRef) {
    const workspaceDir = await this.ensureWorkspaceDir();
    const target = String(fileRef || "").trim();
    if (!target) {
      throw new Error("Workspace file path or name is required.");
    }

    const directPath = path.resolve(workspaceDir, target);
    const relativeToWorkspace = path.relative(workspaceDir, directPath);
    if (relativeToWorkspace && !relativeToWorkspace.startsWith("..") && !path.isAbsolute(relativeToWorkspace)) {
      try {
        const fileStat = await stat(directPath);
        if (fileStat.isFile()) {
          return directPath;
        }
      } catch {
        // Fall through to name lookup.
      }
    }

    const files = await listFilesRecursive(workspaceDir);
    const normalized = target.replaceAll("\\", "/").toLowerCase();
    const match = files.find((filePath) => {
      const relativePath = path.relative(workspaceDir, filePath).replaceAll("\\", "/").toLowerCase();
      return relativePath === normalized || path.basename(filePath).toLowerCase() === normalized;
    });

    if (!match) {
      throw new Error(`Workspace file "${target}" was not found.`);
    }
    return match;
  }

  async listWorkspaceFiles({ query = "", maxFiles = 200 } = {}) {
    const workspaceDir = await this.ensureWorkspaceDir();
    const limit = clampInt(maxFiles, 200, { min: 1, max: 500 });
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const filePaths = await listFilesRecursive(workspaceDir, { maxFiles: limit });
    const files = [];

    for (const filePath of filePaths) {
      const fileStat = await stat(filePath);
      const summary = summarizeLocalFile(filePath, workspaceDir, fileStat);
      if (
        normalizedQuery &&
        !summary.name.toLowerCase().includes(normalizedQuery) &&
        !summary.relativePath.toLowerCase().includes(normalizedQuery)
      ) {
        continue;
      }
      files.push(summary);
    }

    files.sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)));
    return {
      workspaceDir,
      count: files.length,
      files,
    };
  }

  async readWorkspaceFile({ file, maxChars = 8000 } = {}) {
    const filePath = await this.resolveWorkspaceFile(file);
    const result = await this.readLocalAttachment(filePath, maxChars);
    return {
      workspaceDir: this.workspaceDir(),
      file: result,
    };
  }

  async renameWorkspaceFile({ file, newName } = {}) {
    const oldPath = await this.resolveWorkspaceFile(file);
    const workspaceDir = await this.ensureWorkspaceDir();
    const safeName = sanitizeWorkspaceFileName(newName, path.basename(oldPath));
    const oldExt = path.extname(oldPath);
    const nextName = path.extname(safeName) ? safeName : `${safeName}${oldExt}`;
    const nextPath = path.join(path.dirname(oldPath), nextName);
    const relativeToWorkspace = path.relative(workspaceDir, nextPath);
    if (relativeToWorkspace.startsWith("..") || path.isAbsolute(relativeToWorkspace)) {
      throw new Error("New workspace file name must stay inside the workspace.");
    }

    await rename(oldPath, nextPath);
    const fileStat = await stat(nextPath);
    return {
      workspaceDir,
      oldPath,
      file: summarizeLocalFile(nextPath, workspaceDir, fileStat),
    };
  }

  async writeWorkspaceTextFile({ fileName, content, overwrite = false } = {}) {
    const workspaceDir = await this.ensureWorkspaceDir();
    const safeName = sanitizeWorkspaceFileName(fileName, "assistant-note.md");
    const filePath = path.join(workspaceDir, safeName);
    if (!overwrite) {
      try {
        await stat(filePath);
        throw new Error(`Workspace file "${safeName}" already exists. Choose another name or set overwrite=true.`);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }

    await writeFile(filePath, String(content || ""), "utf8");
    const fileStat = await stat(filePath);
    return {
      workspaceDir,
      file: summarizeLocalFile(filePath, workspaceDir, fileStat),
    };
  }

  async saveSession(session) {
    await this.store.save(session);
    return session;
  }

  async captureSessionFromPage(page, source) {
    const storage = await page.evaluate((keys) => {
      return Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
    }, STORAGE_KEYS);

    const session = this.buildSessionFromStorage(storage, source);
    await this.saveSession(session);
    await this.refreshContext(session);
    return session;
  }

  buildSessionFromStorage(storage, source = "imported-storage") {
    const parsed = parseStorageMap(storage);
    const auth = ensureObject(parsed.tokens);
    const userInfo = ensureObject(parsed.userInfo);

    if (!auth.access_token) {
      throw new Error("Imported storage does not contain tokens.access_token.");
    }

    if (!userInfo.id) {
      throw new Error("Imported storage does not contain userInfo.id.");
    }

    const context = {
      userInfo,
      curClass: parsed.curClass,
      currTermId: parsed.currTermId,
      curSubject: parsed.curSubject,
      subjectList: Array.isArray(parsed.subjectList) ? parsed.subjectList : [],
      termList: Array.isArray(parsed.termList) ? parsed.termList : [],
      menuData: Array.isArray(parsed.menuData) ? parsed.menuData : [],
      topMenuArray: Array.isArray(parsed.topMenuArray) ? parsed.topMenuArray : [],
      loginName: parsed.loginName,
      deviceId: parsed.deviceId,
    };

    return {
      baseUrl: BASE_URL,
      source,
      capturedAt: new Date().toISOString(),
      auth: {
        ...auth,
        obtainedAt: new Date().toISOString(),
      },
      storage: buildStorageFromContext(storage, context, auth),
      context,
    };
  }

  async interactiveLogin({ headless = false, timeoutMs = 300000 } = {}) {
    let browser;
    browser = await launchBrowser(headless);

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/achievement_list`, { waitUntil: "domcontentloaded" });

      await page.waitForFunction(
        () => {
          const tokens = localStorage.getItem("tokens");
          const userInfo = localStorage.getItem("userInfo");
          return Boolean(tokens && userInfo);
        },
        undefined,
        { timeout: timeoutMs },
      );
      const session = await this.captureSessionFromPage(page, "interactive-login");

      return {
        ...this.summarizeSession(session),
        finalUrl: page.url(),
        note: "Interactive login captured browser localStorage and refreshed page context.",
      };
    } finally {
      await browser?.close();
    }
  }

  async loginWithCredentials({
    username,
    password,
    headless = false,
    timeoutMs = 60000,
    agreeTerms = true,
  } = {}) {
    if (!username || !password) {
      throw new Error("username and password are required.");
    }

    let browser;
    browser = await launchBrowser(headless);

    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/login`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });

      await page.getByPlaceholder("请输入账号").fill(String(username));
      await page.getByPlaceholder("请输入密码").fill(String(password));

      if (agreeTerms) {
        const checkbox = page.locator('input[type="checkbox"]').first();
        if ((await checkbox.count()) > 0 && !(await checkbox.isChecked())) {
          await checkbox.check({ force: true });
        }
      }

      const loginButton = page.getByRole("button", { name: /登录/ }).first();
      await loginButton.click();

      try {
        await page.waitForFunction(
          () => {
            const tokens = localStorage.getItem("tokens");
            const userInfo = localStorage.getItem("userInfo");
            return Boolean(tokens && userInfo);
          },
          undefined,
          { timeout: timeoutMs },
        );
      } catch (error) {
        const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
        throw new Error(
          `Login did not complete. URL: ${page.url()}. Page text preview: ${bodyText.slice(0, 300)}`,
        );
      }

      const session = await this.captureSessionFromPage(page, "credential-login");

      return {
        ...this.summarizeSession(session),
        finalUrl: page.url(),
        note: "Credential login filled the login form in a browser, captured localStorage, and refreshed page context.",
      };
    } finally {
      await browser?.close();
    }
  }

  async importBrowserStorage(storageJson) {
    const storage =
      typeof storageJson === "string" ? JSON.parse(storageJson) : ensureObject(storageJson);
    const session = this.buildSessionFromStorage(storage, "manual-storage-import");
    await this.saveSession(session);
    await this.refreshContext(session);
    return this.summarizeSession(session);
  }

  async clearSession() {
    await this.store.clear();
    return {
      cleared: true,
      sessionFile: this.store.sessionFile,
    };
  }

  async maybeRefreshToken(session) {
    const auth = ensureObject(session.auth);
    if (!auth.refresh_token || !auth.expires_in || !auth.obtainedAt) {
      return session;
    }

    const expiresAt = new Date(auth.obtainedAt).getTime() + Number(auth.expires_in) * 1000;
    if (Number.isNaN(expiresAt)) {
      return session;
    }

    if (Date.now() < expiresAt - 60000) {
      return session;
    }

    return this.refreshToken(session);
  }

  async refreshToken(session) {
    if (!session.auth?.refresh_token) {
      throw new Error("The current session does not contain a refresh token.");
    }

    const url = new URL("/gateway/auth/oauth/token", session.baseUrl || BASE_URL);
    url.searchParams.set("grant_type", "refresh_token");
    url.searchParams.set("refresh_token", session.auth.refresh_token);
    url.searchParams.set("scope", "server");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: BASIC_AUTH,
      },
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`Refresh token request failed: ${JSON.stringify(payload)}`);
    }

    session.auth = {
      ...payload,
      obtainedAt: new Date().toISOString(),
    };
    session.storage.tokens = stringifyStorageValue(session.auth);
    await this.saveSession(session);
    return session;
  }

  async request(session, method, endpoint, { params, body, headers, retryOn401 = true } = {}) {
    const currentSession = await this.maybeRefreshToken(session);
    const url = new URL(endpoint, currentSession.baseUrl || BASE_URL);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === "") {
          continue;
        }

        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        VERSION: "CLOUDRISE",
        deviceType: "web",
        Authorization: currentSession.auth?.access_token
          ? `Bearer ${currentSession.auth.access_token}`
          : undefined,
        "Content-Type": body ? "application/json" : undefined,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const contentType = response.headers.get("content-type") || "";
    const responseText = await response.text();
    const payload = contentType.includes("application/json")
      ? responseText
        ? JSON.parse(responseText)
        : null
      : responseText;

    if (response.status === 401 && retryOn401 && currentSession.auth?.refresh_token) {
      const refreshed = await this.refreshToken(currentSession);
      return this.request(refreshed, method, endpoint, {
        params,
        body,
        headers,
        retryOn401: false,
      });
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${endpoint}: ${JSON.stringify(payload)}`);
    }

    return payload;
  }

  async refreshContext(existingSession = null) {
    const session = existingSession || (await this.requireSession());
    const userInfo = ensureObject(session.context?.userInfo);

    if (!userInfo.id) {
      throw new Error(
        "Session exists but userInfo.id is missing. Re-capture the session from a logged-in browser.",
      );
    }

    const classResponse = safeBusinessResult(
      await this.request(session, "GET", `/gateway/platform/Learning/user/${userInfo.id}/class`, {
        params: { classType: 0 },
      }),
      "class-list",
    );
    const classList = Array.isArray(classResponse.data) ? classResponse.data : [];

    const currentClass =
      findById(classList, session.context?.curClass?.id) || classList.at(0) || null;

    const termResponse = safeBusinessResult(
      await this.request(session, "GET", "/gateway/platform/business/common/term", {
        params: { studentId: userInfo.id },
      }),
      "term-list",
    );
    const termList = Array.isArray(termResponse.data) ? termResponse.data : [];

    const currentTerm =
      findById(termList, session.context?.currTermId) ||
      termList.find((term) => Boolean(term.status)) ||
      termList.at(0) ||
      null;

    const currentTermId = currentTerm ? currentTerm.id : null;

    let subjectList = [];
    if (currentClass?.id && currentTermId) {
      const subjectResponse = safeBusinessResult(
        await this.request(
          session,
          "GET",
          `/gateway/bxb/student/${userInfo.id}/class/${currentClass.id}/course-list`,
          {
            params: { termId: currentTermId },
          },
        ),
        "subject-list",
      );

      subjectList = Array.isArray(subjectResponse.data) ? subjectResponse.data : [];
    }

    const currentSubject = isAllSubject(session.context?.curSubject)
      ? buildAllSubject()
      : subjectList.find(
          (subject) =>
            normalizeId(subject.id) === normalizeId(session.context?.curSubject?.id) &&
            normalizeId(subject.classId) === normalizeId(session.context?.curSubject?.classId),
        ) ||
        subjectList.at(0) ||
        null;

    session.context = {
      ...session.context,
      userInfo,
      classList,
      curClass: currentClass,
      termList,
      currTermId: currentTermId,
      subjectList,
      curSubject: currentSubject,
    };
    session.storage = buildStorageFromContext(session.storage, session.context, session.auth);
    await this.saveSession(session);

    return this.summarizeSession(session);
  }

  async setCurrentTerm(termId) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const target = findById(session.context.termList || [], termId);
    if (!target) {
      throw new Error(`Term ${termId} was not found in the current session.`);
    }

    session.context.currTermId = target.id;
    session.storage.currTermId = String(target.id);
    await this.saveSession(session);

    return this.refreshContext(session);
  }

  async setCurrentTermByName(termName) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const target = findByName(session.context.termList || [], termName, [
      (term) => term.name,
      (term) => term.termName,
    ]);
    if (!target) {
      throw new Error(`Term "${termName}" was not found in the current session.`);
    }

    return this.setCurrentTerm(target.id);
  }

  async setCurrentSubject(subjectId, classId = null) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    if (normalizeId(subjectId) === ALL_SUBJECT_ID || isAllSubjectName(subjectId)) {
      const target = buildAllSubject();
      session.context.curSubject = target;
      session.storage.curSubject = stringifyStorageValue(target);
      await this.saveSession(session);
      return this.summarizeSession(session);
    }

    const target = findById(session.context.subjectList || [], subjectId, (subject) => {
      if (!classId) {
        return true;
      }

      return normalizeId(subject.classId) === normalizeId(classId);
    });

    if (!target) {
      throw new Error(
        `Subject ${subjectId}${classId ? ` (class ${classId})` : ""} was not found in the current session.`,
      );
    }

    session.context.curSubject = target;
    session.storage.curSubject = stringifyStorageValue(target);
    await this.saveSession(session);
    return this.summarizeSession(session);
  }

  async setCurrentSubjectByName(subjectName, classId = null) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    if (isAllSubjectName(subjectName)) {
      const target = buildAllSubject();
      session.context.curSubject = target;
      session.storage.curSubject = stringifyStorageValue(target);
      await this.saveSession(session);
      return this.summarizeSession(session);
    }

    const target = findByName(
      session.context.subjectList || [],
      subjectName,
      [(subject) => subject.cnName, (subject) => subject.name],
      (subject) => {
        if (!classId) {
          return true;
        }

        return normalizeId(subject.classId) === normalizeId(classId);
      },
    );

    if (!target) {
      throw new Error(
        `Subject "${subjectName}"${classId ? ` (class ${classId})` : ""} was not found in the current session.`,
      );
    }

    return this.setCurrentSubject(target.id, target.classId);
  }

  async listCourses() {
    const session = await this.requireSession();
    await this.refreshContext(session);

    return {
      context: this.summarizeSession(session),
      currentTermId: session.context.currTermId || null,
      currentClass: session.context.curClass || null,
      courses: [
        {
          id: ALL_SUBJECT_ID,
          classId: null,
          name: "全部课程",
          color: "#0067c0",
          unSubmitCount: null,
          allSubjects: true,
        },
        ...toArray(session.context.subjectList).map(summarizeCourse),
      ],
    };
  }

  async listTerms() {
    const session = await this.requireSession();
    await this.refreshContext(session);

    return {
      context: this.summarizeSession(session),
      terms: toArray(session.context.termList).map((term) => ({
        id: normalizeId(term.id),
        name: term.name || term.termName || null,
        status: term.status ?? null,
      })),
    };
  }

  async applyContextOverrides({
    termId,
    termName,
    subjectId,
    subjectName,
    classId = null,
  } = {}) {
    let context = null;

    if (termId !== undefined && termId !== null) {
      context = await this.setCurrentTerm(termId);
    } else if (termName) {
      context = await this.setCurrentTermByName(termName);
    }

    if (subjectId !== undefined && subjectId !== null) {
      context = await this.setCurrentSubject(subjectId, classId);
    } else if (subjectName) {
      context = await this.setCurrentSubjectByName(subjectName, classId);
    }

    return context;
  }

  normalizeHomeworkListType(listType) {
    if (listType === "latest") {
      return 1;
    }
    if (listType === "pending") {
      return 2;
    }
    return -1;
  }

  async queryHomeworkForSubject(session, subject, { listType = "all", page = 1, size = 10 } = {}) {
    const { userInfo, currTermId } = session.context;
    const query = {
      page,
      size,
      leamTermIds: currTermId,
      classId: subject.classId,
    };

    const normalizedListType = this.normalizeHomeworkListType(listType);
    const courseName = subject.cnName || subject.name || null;
    const tagCourse = (task) => ({
      ...enrichHomeworkRecord(task),
      courseId: task.courseId || subject.id,
      courseName: task.courseName || courseName,
      classId: task.classId || subject.classId,
    });

    let unsubmittedHomeworkList = [];
    if (normalizedListType === -1) {
      const unsubmittedResponse = safeBusinessResult(
        await this.request(
          session,
          "GET",
          `/gateway/bxb/student/${userInfo.id}/course/${subject.id}/un-submit-homework`,
          {
            params: {
              leamTermIds: currTermId,
              classId: subject.classId,
            },
          },
        ),
        "un-submit-homework",
      );
      unsubmittedHomeworkList = Array.isArray(unsubmittedResponse.data)
        ? unsubmittedResponse.data.map(tagCourse)
        : [];
    }

    const homeworkEndpoint =
      normalizedListType === -1
        ? `/gateway/bxb/student/${userInfo.id}/course/${subject.id}/page-query-homework`
        : `/gateway/bxb/student/${userInfo.id}/course/${subject.id}/page-query-homework2`;

    const homeworkResponse = safeBusinessResult(
      await this.request(session, "GET", homeworkEndpoint, {
        params:
          normalizedListType === -1
            ? query
            : {
                ...query,
                listType: normalizedListType,
              },
      }),
      "page-query-homework",
    );

    const data = ensureObject(homeworkResponse.data);
    const homeworkList = Array.isArray(data.aaData) ? data.aaData.map(tagCourse) : [];

    return {
      query: {
        ...query,
        courseId: subject.id,
        courseName,
        listType: normalizedListType,
      },
      totalRecords: data.iTotalRecords ?? homeworkList.length,
      unsubmittedHomeworkList,
      homeworkList,
    };
  }

  async listHomework({ listType = "all", page = 1, size = 10 } = {}) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const { userInfo, curSubject, currTermId, subjectList } = session.context;
    if (!userInfo?.id || !currTermId) {
      throw new Error("Current session does not have enough context to query homework.");
    }

    if (isAllSubject(curSubject)) {
      const subjects = toArray(subjectList).filter((subject) => subject?.id && subject?.classId);
      const results = [];
      for (const subject of subjects) {
        results.push(await this.queryHomeworkForSubject(session, subject, { listType, page, size }));
      }

      return {
        context: this.summarizeSession(session),
        query: {
          page,
          size,
          leamTermIds: currTermId,
          allSubjects: true,
          listType: this.normalizeHomeworkListType(listType),
        },
        totalRecords: results.reduce((sum, item) => sum + Number(item.totalRecords || 0), 0),
        unsubmittedHomeworkList: results.flatMap((item) => item.unsubmittedHomeworkList),
        homeworkList: results.flatMap((item) => item.homeworkList),
        courseResults: results,
      };
    }

    if (!curSubject?.id || !curSubject?.classId) {
      throw new Error("Current session does not have enough subject context to query homework.");
    }

    const result = await this.queryHomeworkForSubject(session, curSubject, { listType, page, size });

    return {
      context: this.summarizeSession(session),
      ...result,
    };
  }

  async listTasks(options = {}) {
    const {
      termId,
      termName,
      subjectId,
      subjectName,
      classId,
      ...homeworkOptions
    } = options;

    if (
      termId !== undefined ||
      termName ||
      subjectId !== undefined ||
      subjectName ||
      classId !== undefined
    ) {
      await this.applyContextOverrides({
        termId,
        termName,
        subjectId,
        subjectName,
        classId,
      });
    }

    return this.listHomework(homeworkOptions);
  }

  async getAchievementOverview({ transferClassId = null } = {}) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const { userInfo, curClass, curSubject, currTermId } = session.context;
    if (!userInfo?.id || !curClass?.campusId || !curSubject?.id || !curSubject?.classId || !currTermId) {
      throw new Error("Current session does not have enough context to query achievements.");
    }

    const scoreTypeResponse = safeBusinessResult(
      await this.request(
        session,
        "GET",
        `/gateway/bxb/scoretype/class/${curSubject.classId}/course/${curSubject.id}/group`,
        {
          params: { termId: currTermId },
        },
      ),
      "scoretype-group",
    );

    const gpaResponse = safeBusinessResult(
      await this.request(session, "POST", "/gateway/bxb/student/queryGPA", {
        body: {
          classId: curSubject.classId,
          courseId: curSubject.id,
          termId: currTermId,
          userId: userInfo.id,
        },
      }),
      "queryGPA",
    );

    const gpaData = ensureObject(gpaResponse.data);
    const transferClassGpaList = Array.isArray(gpaData.transferClassGpaList)
      ? gpaData.transferClassGpaList.map((record) => ({
          ...record,
          teacherNames: Array.isArray(record.teacherNames)
            ? record.teacherNames.join(",")
            : record.teacherNames || "",
          srcInTimeCopy: record.srcInTime ? String(record.srcInTime).slice(0, 10) : "",
          srcOutTimeCopy: record.srcOutTime ? String(record.srcOutTime).slice(0, 10) : "至今",
        }))
      : [];

    const selectedTransfer =
      findById(transferClassGpaList, transferClassId) || transferClassGpaList.at(-1) || null;

    let scoreLevelList = [];
    let achievementList = [];
    if (selectedTransfer?.classId && selectedTransfer?.srcCourseId) {
      const scoreLevelResponse = safeBusinessResult(
        await this.request(
          session,
          "GET",
          `/gateway/bxb/scorelevel/class/${selectedTransfer.classId}/course/${selectedTransfer.srcCourseId}`,
          {
            params: { campusId: curClass.campusId },
          },
        ),
        "scorelevel",
      );

      scoreLevelList = Array.isArray(scoreLevelResponse.data)
        ? scoreLevelResponse.data.filter((item) => item.status)
        : [];

      const chartResponse = safeBusinessResult(
        await this.request(session, "POST", "/gateway/bxb/scorerecord/queryGpaChartData", {
          body: {
            classId: selectedTransfer.classId,
            currClass: selectedTransfer.currClass,
            srcCourseId: selectedTransfer.srcCourseId,
            srcInTime: selectedTransfer.srcInTime,
            srcOutTime: selectedTransfer.srcOutTime,
            termId: currTermId,
            userId: userInfo.id,
          },
        }),
        "queryGpaChartData",
      );

      achievementList = Array.isArray(chartResponse.data)
        ? chartResponse.data.map((item) => ({ ...item, isChecked: true }))
        : [];
    }

    return {
      context: this.summarizeSession(session),
      averageLevel: gpaData.level ?? null,
      scoreTypes: Array.isArray(scoreTypeResponse.data) ? scoreTypeResponse.data : [],
      transferClassOptions: transferClassGpaList,
      selectedTransferClass: selectedTransfer,
      scoreLevelList,
      achievementList,
    };
  }

  async getCurrentSubjectGpa() {
    const overview = await this.getAchievementOverview();

    return {
      context: overview.context,
      currentSubject: overview.context.currentSubject,
      averageLevel: overview.averageLevel,
      selectedTransferClass: overview.selectedTransferClass,
      achievementCount: overview.achievementList.length,
      scoreLevelCount: overview.scoreLevelList.length,
    };
  }

  async getSchedule() {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const { userInfo, curClass, currTermId } = session.context;
    const campusId = ensureObject(curClass).campusId;

    if (!userInfo?.id || !campusId || !currTermId) {
      return {
        schedule: {},
        timeSlots: {},
        hasData: false,
      };
    }

    const response = await fetch(
      `${session.baseUrl || BASE_URL}/gateway/arrange-course/courseTable/student/${userInfo.id}/getSchemeTable/teach?campusId=${campusId}&termId=${currTermId}`,
      {
        headers: {
          Authorization: `Bearer ${session.auth.access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    const result = await response.json();
    if (!response.ok || result.code !== 0) {
      return {
        schedule: {},
        timeSlots: {},
        hasData: false,
      };
    }

    const data = result.data || {};
    const weekDays = Array.isArray(data.weekDays) ? data.weekDays : [];

    // Build schedule map: { day: { lesson: { time, courses: [...] } } }
    const schedule = {};
    const timeSlots = {};

    for (const dayData of weekDays) {
      const dayKey = Number(dayData.day) + 1; // API uses 0-4, we use 1-5 for Mon-Fri
      if (dayKey < 1 || dayKey > 5) {
        continue;
      }

      schedule[dayKey] = {};

      const allSlots = [
        ...(dayData.forenoonLessonTimeSets || []),
        ...(dayData.afternoonLessonTimeSets || []),
        ...(dayData.eveningLessonTimeSets || []),
      ];

      for (const slot of allSlots) {
        const lesson = Number(slot.lesson);
        const timeRange = `${slot.startTime}-${slot.endTime}`;
        timeSlots[lesson] = timeRange;

        const courses = (slot.teachList || []).map((teach) => ({
          name: teach.customCourseName || teach.courseName || "",
          teacher: teach.teacherName || "",
          room: teach.classRoomName || "",
          color: teach.courseColor || "#2563EB",
        }));

        schedule[dayKey][lesson] = {
          time: timeRange,
          courses,
        };
      }
    }

    return {
      schedule,
      timeSlots,
      hasData: Object.keys(schedule).length > 0,
    };
  }

  async listPrivateMessageContacts() {
    const session = await this.requireSession();
    const userInfo = ensureObject(session.context?.userInfo);
    if (!userInfo.id) {
      throw new Error("Current session does not have userInfo.id.");

    }

    const response = safeBusinessResult(
      await this.request(session, "GET", `/gateway/bxb/priv-msg/user/${userInfo.id}/contact-list`, {
        params: { userType: "S" },
      }),
      "priv-msg-contact-list",
    );

    const contacts = Array.isArray(response.data) ? response.data.map(summarizePrivateContact) : [];
    return {
      contacts,
      count: contacts.length,
    };
  }

  async getPrivateMessageThread(contact, { size = 20, endTime = "" } = {}) {
    const session = await this.requireSession();
    const source = ensureObject(contact?.raw || contact);
    const classId = normalizeId(source.classId);
    if (!classId || !source.receiverId || !source.senderId) {
      throw new Error("Private message contact requires classId, receiverId, and senderId.");
    }

    const response = safeBusinessResult(
      await this.request(session, "GET", `/gateway/bxb/priv-msg-content/class/${classId}/page-query`, {
        params: {
          size,
          classId,
          receiverId: source.receiverId,
          senderId: source.senderId,
          childId: source.childId || "",
          startTime: "",
          endTime,
          receiverType: source.receiverType,
          senderType: source.senderType,
        },
      }),
      "priv-msg-content-page-query",
    );

    const page = ensureObject(response.data);
    const messages = Array.isArray(page.aaData)
      ? page.aaData.map(summarizePrivateMessage).reverse()
      : [];
    return {
      contact: summarizePrivateContact(source),
      messages,
      page: {
        totalPages: page.totalPages ?? null,
        number: page.number ?? null,
        size: page.size ?? size,
        hasContent: page.hasContent ?? messages.length > 0,
        totalRecords: page.iTotalRecords ?? messages.length,
      },
    };
  }

  async sendPrivateMessageText(contact, content) {
    const session = await this.requireSession();
    const source = ensureObject(contact?.raw || contact);
    const normalizedContent = String(content || "").trim();
    if (!normalizedContent) {
      throw new Error("Private message content cannot be empty.");
    }

    const classId = normalizeId(source.classId);
    if (!classId || !source.receiverId || !source.senderId) {
      throw new Error("Private message contact requires classId, receiverId, and senderId.");
    }

    const selfIsReceiver = source.receiverType === "S";
    const body = {
      kinship: selfIsReceiver ? "" : source.kinship || "",
      childId: selfIsReceiver ? "" : source.childId || "",
      receiverType: selfIsReceiver ? source.senderType : source.receiverType,
      receiverId: selfIsReceiver ? source.senderId : source.receiverId,
      senderId: selfIsReceiver ? source.receiverId : source.senderId,
      senderType: "S",
      classId,
      content: normalizedContent,
      contentType: "T",
    };

    const response = safeBusinessResult(
      await this.request(session, "POST", "/gateway/bxb/priv-msg-content/send", {
        body,
      }),
      "priv-msg-content-send",
    );

    return {
      sent: true,
      message: response.data ? summarizePrivateMessage(response.data) : null,
    };
  }

  async getTaskDetail(taskId, { includeOtherSubmissions = false } = {}) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const { userInfo, curSubject } = session.context;
    if (!userInfo?.id) {
      throw new Error("Current session does not have enough context to query task detail.");
    }

    const detailResponse = safeBusinessResult(
      await this.request(
        session,
        "GET",
        `/gateway/bxb/student/${userInfo.id}/activity/${taskId}/detail`,
      ),
      "activity-detail",
    );
    const task = ensureObject(detailResponse.data);
    const taskClassId = curSubject?.classId || task.classId;
    if (!taskClassId) {
      throw new Error("Current task detail does not include classId.");
    }

    const requestList = [
      this.request(
        session,
        "GET",
        `/gateway/bxb/student/activity/${taskId}/activity-work-correct/list`,
        {
          params: { studentId: userInfo.id },
        },
      ).catch(() => ({ data: [] })),
      includeOtherSubmissions
        ? this.request(
            session,
            "GET",
            `/gateway/bxb/activityWork/homework/${taskId}/submitted/list`,
            {
              params: { classId: taskClassId },
            },
          ).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      this.request(
        session,
        "GET",
        `/gateway/bxb/activityWork/homework/${taskId}/student/${userInfo.id}/last-score`,
        {
          params: { classId: taskClassId },
        },
      ).catch(() => ({ data: null })),
    ];

    const [mySubmissionResponse, submittedResponse, lastScoreResponse] = await Promise.all(requestList);

    const mySubmissionList = toArray(mySubmissionResponse.data);
    const submittedList = toArray(submittedResponse.data);
    const lastScore = lastScoreResponse?.data ?? null;
    const taskAttachments = collectAttachments(task.fileList, "task");
    const referenceAttachments = collectAttachments(task.activityTask?.fileList, "reference");
    const mySubmissionAttachments = mySubmissionList.flatMap((item) =>
      collectAttachments(item.fileList, "my-submission"),
    );
    const peerSubmissionAttachments = submittedList.flatMap((item) =>
      collectAttachments(item.fileList, "submitted"),
    );

    return {
      context: this.summarizeSession(session),
      taskId: normalizeId(taskId),
      taskSummary: summarizeTask(task),
      task,
      contentText: stripHtml(task.activityContent || task.activityTask?.content || ""),
      answerText: stripHtml(task.activityTask?.answer || ""),
      attachments: [...taskAttachments, ...referenceAttachments],
      includeOtherSubmissions,
      mySubmissionList,
      mySubmissionAttachments,
      submittedList: includeOtherSubmissions ? submittedList : [],
      peerSubmissionAttachments: includeOtherSubmissions ? peerSubmissionAttachments : [],
      otherSubmissionCount: submittedList.length,
      lastScore,
    };
  }

  async readTaskContent(taskId, maxChars = 4000) {
    const detail = await this.getTaskDetail(taskId);
    const contentPreview = buildTextPreview(detail.contentText, maxChars);
    const answerPreview = buildTextPreview(detail.answerText, maxChars);

    return {
      context: detail.context,
      taskId: detail.taskId,
      taskSummary: detail.taskSummary,
      attachments: detail.attachments,
      content: contentPreview.text,
      contentTruncated: contentPreview.truncated,
      contentLength: contentPreview.totalChars,
      answer: answerPreview.text,
      answerTruncated: answerPreview.truncated,
      answerLength: answerPreview.totalChars,
    };
  }

  async downloadFile(fileId, { directory, fileName } = {}) {
    const session = await this.requireSession();
    const downloadDir = directory || (await this.ensureWorkspaceDir());
    const accessToken = session.auth?.access_token;
    if (!accessToken) {
      throw new Error("The current session does not contain an access token.");
    }

    await mkdir(downloadDir, { recursive: true });

    const url = new URL(
      `/gateway/filesystem/file/download/${fileId}`,
      session.baseUrl || BASE_URL,
    );
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "*/*",
        VERSION: "CLOUDRISE",
        deviceType: "web",
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json")
        ? await response.json()
        : await response.text();
      throw new Error(`HTTP ${response.status} file-download: ${JSON.stringify(payload)}`);
    }

    const responseFileName =
      fileName || parseDispositionFilename(response.headers.get("content-disposition"));
    const resolvedFileName = sanitizeFileName(
      responseFileName || `${fileId}${path.extname(responseFileName || "")}`,
      String(fileId),
    );
    const targetPath = path.join(downloadDir, resolvedFileName);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(targetPath, buffer);

    return {
      fileId: normalizeId(fileId),
      fileName: resolvedFileName,
      path: targetPath,
      contentType: response.headers.get("content-type") || null,
      sizeBytes: buffer.byteLength,
    };
  }

  async downloadTaskAttachment({ taskId, fileId, directory } = {}) {
    let attachment = null;

    if (taskId) {
      const detail = await this.getTaskDetail(taskId);
      attachment = [
        ...detail.attachments,
        ...detail.mySubmissionAttachments,
        ...detail.peerSubmissionAttachments,
      ].find((item) => normalizeId(item.fileId) === normalizeId(fileId));

      if (!attachment) {
        throw new Error(`Attachment ${fileId} was not found on task ${taskId}.`);
      }
    }

    return this.downloadFile(fileId, {
      directory,
      fileName: attachment?.fileName || attachment?.name,
    });
  }

  async readLocalAttachment(filePath, maxChars = 4000) {
    const resolvedPath = path.resolve(filePath);
    const buffer = await readFile(resolvedPath);
    const extension = path.extname(resolvedPath).toLowerCase();
    let text = "";
    let readable = true;
    let reader = "plain-text";

    if (TEXT_FILE_EXTENSIONS.has(extension)) {
      text = parseTextBuffer(buffer, extension);
    } else if (extension === ".pdf") {
      const pdfParseModule = await import("pdf-parse");
      const PDFParse = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse;

      if (typeof PDFParse !== "function") {
        throw new Error("pdf-parse did not expose a PDFParse constructor");
      }

      const parser = new PDFParse({ data: buffer });

      try {
        const parsed = await parser.getText();
        text = parsed.text || "";
      } finally {
        await parser.destroy();
      }

      reader = "pdf-parse";
    } else if (extension === ".docx") {
      const mammothModule = await import("mammoth");
      const mammoth = mammothModule.default || mammothModule;
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
      reader = "mammoth";
    } else {
      readable = false;
    }

    const preview = buildTextPreview(text, maxChars);

    return {
      path: resolvedPath,
      fileName: path.basename(resolvedPath),
      extension,
      readable,
      reader,
      text: preview.text,
      truncated: preview.truncated,
      totalChars: preview.totalChars,
      note: readable ? null : "This attachment type is not supported for text extraction yet.",
    };
  }

  async readTaskAttachment({ taskId, fileId, maxChars = 4000, directory } = {}) {
    const downloaded = await this.downloadTaskAttachment({ taskId, fileId, directory });
    const parsed = await this.readLocalAttachment(downloaded.path, maxChars);

    return {
      taskId: taskId ? normalizeId(taskId) : null,
      fileId: normalizeId(fileId),
      download: downloaded,
      read: parsed,
    };
  }

  async collectTaskSubmissionContext(taskId, { maxChars = 4000, maxAttachments = 6 } = {}) {
    const detail = await this.getTaskDetail(taskId, { includeOtherSubmissions: false });
    const attachments = [...detail.attachments];
    const attachmentContexts = [];

    for (const attachment of attachments.slice(0, Math.max(1, maxAttachments))) {
      try {
        const result = await this.readTaskAttachment({
          taskId,
          fileId: attachment.fileId,
          maxChars,
        });
        attachmentContexts.push({
          fileId: attachment.fileId,
          fileName: attachment.fileName || attachment.name || null,
          category: attachment.category || null,
          readable: Boolean(result.read?.readable),
          text: result.read?.text || "",
          truncated: Boolean(result.read?.truncated),
          totalChars: result.read?.totalChars ?? 0,
          note: result.read?.note || null,
          error: null,
        });
      } catch (error) {
        attachmentContexts.push({
          fileId: attachment.fileId,
          fileName: attachment.fileName || attachment.name || null,
          category: attachment.category || null,
          readable: false,
          text: "",
          truncated: false,
          totalChars: 0,
          note: null,
          error: error.message,
        });
      }
    }

    const contentPreview = buildTextPreview(detail.contentText || "", maxChars);
    const answerPreview = buildTextPreview(detail.answerText || "", maxChars);
    const readableAttachmentCount = attachmentContexts.filter((item) => item.readable && item.text).length;
    const missingInfo = [];

    if (!contentPreview.text && !answerPreview.text && readableAttachmentCount === 0) {
      missingInfo.push("任务正文和附件都没有可读文本，无法可靠生成提交草稿。");
    }
    if (attachments.length > maxAttachments) {
      missingInfo.push(`附件较多，本次只读取了前 ${maxAttachments} 个附件。`);
    }

    return {
      context: detail.context,
      collectedAt: new Date().toISOString(),
      taskId: detail.taskId,
      taskSummary: detail.taskSummary,
      subjectName: detail.context?.currentSubject?.name || null,
      contentText: contentPreview.text,
      contentTruncated: contentPreview.truncated,
      answerText: answerPreview.text,
      answerTruncated: answerPreview.truncated,
      attachments,
      attachmentContexts,
      mySubmissionAttachments: detail.mySubmissionAttachments || [],
      requirementsSummary: buildTextPreview(
        [detail.taskSummary?.activityName, detail.contentText, detail.answerText]
          .filter(Boolean)
          .join("\n\n"),
        1500,
      ).text,
      missingInfo,
      isSufficient: missingInfo.length === 0,
    };
  }

  async draftTaskSubmission({
    taskId,
    subjectName = null,
    taskTitle = null,
    draftText,
    summary = "",
    evidence = [],
    warnings = [],
    missingInfo = [],
    needsUserInput = false,
  } = {}) {
    const normalizedDraftText = String(draftText || "").trim();
    if (!normalizedDraftText) {
      throw new Error("draft_text is required and cannot be empty.");
    }

    const session = await this.getSession();
    const sessionSummary = this.summarizeSession(session);
    const now = new Date().toISOString();
    const draftId = `draft_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const draft = {
      draftId,
      status: "pending_review",
      createdAt: now,
      updatedAt: now,
      reviewedAt: null,
      reviewNote: null,
      taskId: normalizeId(taskId),
      subjectName: subjectName || sessionSummary.currentSubject?.name || null,
      taskTitle: taskTitle || null,
      draftText: normalizedDraftText,
      summary: String(summary || "").trim(),
      evidence: Array.isArray(evidence) ? evidence : [],
      warnings: Array.isArray(warnings) ? warnings : [],
      missingInfo: Array.isArray(missingInfo) ? missingInfo : [],
      needsUserInput: Boolean(needsUserInput),
      sourceSession: sessionSummary,
    };

    await this.draftStore.save(draft);

    return {
      saved: true,
      draftId,
      status: draft.status,
      taskId: draft.taskId,
      subjectName: draft.subjectName,
      taskTitle: draft.taskTitle,
      reviewPath: path.join(this.draftStore.draftDir, `${draftId}.json`),
      draft,
    };
  }

  async listSubmissionDrafts({ status } = {}) {
    const drafts = await this.draftStore.list();
    const normalizedStatus = status ? String(status).trim() : null;
    const statusFilter = normalizedStatus && normalizedStatus !== "all" ? normalizedStatus : null;
    const filtered = normalizedStatus
      ? drafts.filter((item) => !statusFilter || String(item.status || "") === statusFilter)
      : drafts;

    return {
      draftDirectory: this.draftStore.draftDir,
      count: filtered.length,
      drafts: filtered.map((draft) => ({
        draftId: draft.draftId,
        status: draft.status,
        taskId: draft.taskId,
        subjectName: draft.subjectName,
        taskTitle: draft.taskTitle,
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
        reviewedAt: draft.reviewedAt,
        needsUserInput: Boolean(draft.needsUserInput),
        missingInfoCount: Array.isArray(draft.missingInfo) ? draft.missingInfo.length : 0,
        warningCount: Array.isArray(draft.warnings) ? draft.warnings.length : 0,
      })),
    };
  }

  async getSubmissionDraft(draftId) {
    const draft = await this.draftStore.get(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} was not found.`);
    }

    return {
      draftDirectory: this.draftStore.draftDir,
      draft,
    };
  }

  async updateSubmissionDraft(draftId, { draftText, summary } = {}) {
    const normalizedDraftText = String(draftText || "").trim();
    if (!normalizedDraftText) {
      throw new Error("draft_text is required and cannot be empty.");
    }

    const updated = await this.draftStore.update(draftId, async (draft) => ({
      ...draft,
      draftText: normalizedDraftText,
      summary: summary === undefined ? draft.summary : String(summary || "").trim(),
      status: draft.status === "rejected" ? "pending_review" : draft.status,
      reviewedAt: draft.status === "rejected" ? null : draft.reviewedAt,
      reviewNote: draft.status === "rejected" ? null : draft.reviewNote,
      updatedAt: new Date().toISOString(),
    }));

    if (!updated) {
      throw new Error(`Draft ${draftId} was not found.`);
    }

    return {
      draftId: updated.draftId,
      status: updated.status,
      updatedAt: updated.updatedAt,
      draft: updated,
    };
  }

  async approveSubmissionDraft(draftId, { reviewNote = "" } = {}) {
    const updated = await this.draftStore.update(draftId, async (draft) => ({
      ...draft,
      status: "approved",
      reviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewNote: String(reviewNote || "").trim() || null,
    }));

    if (!updated) {
      throw new Error(`Draft ${draftId} was not found.`);
    }

    return {
      draftId: updated.draftId,
      status: updated.status,
      reviewedAt: updated.reviewedAt,
      reviewNote: updated.reviewNote,
      draft: updated,
    };
  }

  async rejectSubmissionDraft(draftId, { reviewNote = "" } = {}) {
    const updated = await this.draftStore.update(draftId, async (draft) => ({
      ...draft,
      status: "rejected",
      reviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reviewNote: String(reviewNote || "").trim() || "Rejected in UI review.",
    }));

    if (!updated) {
      throw new Error(`Draft ${draftId} was not found.`);
    }

    return {
      draftId: updated.draftId,
      status: updated.status,
      reviewedAt: updated.reviewedAt,
      reviewNote: updated.reviewNote,
      draft: updated,
    };
  }

  async deleteSubmissionDraft(draftId) {
    const draft = await this.draftStore.get(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} was not found.`);
    }

    await this.draftStore.clear(draftId);

    return {
      deleted: true,
      draftId: draft.draftId,
      taskId: draft.taskId,
      taskTitle: draft.taskTitle,
    };
  }

  async uploadSubmissionFile(localPath) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const { userInfo } = session.context;
    if (!userInfo?.id) {
      throw new Error("Current session does not have enough context to upload a file.");
    }

    const resolvedPath = path.resolve(localPath);
    const fileBuffer = await readFile(resolvedPath);
    const uploadUrl = new URL(
      `/gateway/filesystem/file/simpleupload/${userInfo.id}`,
      session.baseUrl || BASE_URL,
    );
    const form = new FormData();
    form.append("file", new Blob([fileBuffer]), path.basename(resolvedPath));

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        VERSION: "CLOUDRISE",
        deviceType: "web",
        Authorization: `Bearer ${session.auth.access_token}`,
      },
      body: form,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} file-upload: ${JSON.stringify(payload)}`);
    }

    const uploadResult = payload?.result || payload?.data || payload;
    if (!uploadResult?.id || uploadResult === "上传失败") {
      throw new Error(`Unexpected upload result: ${JSON.stringify(payload)}`);
    }

    await this.request(session, "GET", `/gateway/filesystem/file/update/${uploadResult.id}`, {
      params: { access_token: session.auth.access_token },
    });

    const submissionFile = {
      fileId: uploadResult.id,
      category: guessAttachmentCategory(uploadResult),
      name: uploadResult.filename || path.basename(resolvedPath),
      fileName: uploadResult.filename || path.basename(resolvedPath),
      fileExt: getFileExtension(uploadResult.filename, uploadResult.ext),
      fileType: uploadResult.contenttype || null,
      fileLength: uploadResult.timelength || null,
      fileSize: uploadResult.filesize || fileBuffer.byteLength,
      creatorId: uploadResult.userid || userInfo.id,
      createTime: uploadResult.uploaddate || new Date().toISOString(),
      srcUrl: `/gateway/filesystem/skipView/thumbnail/v2/${uploadResult.id}?access_token=${session.auth.access_token}`,
    };

    return {
      context: this.summarizeSession(session),
      localPath: resolvedPath,
      uploadResult,
      submissionFile,
    };
  }

  async submitTaskResult({
    taskId,
    remark = "",
    fileIds = [],
    filePaths = [],
    isCorrectWork = 0,
    submissionId = null,
  } = {}) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const { userInfo, curSubject } = session.context;
    if (!userInfo?.id || !curSubject?.classId) {
      throw new Error("Current session does not have enough context to submit task results.");
    }

    const uploadedFiles = [];
    for (const filePath of filePaths) {
      const upload = await this.uploadSubmissionFile(filePath);
      uploadedFiles.push(upload.submissionFile);
    }

    let payload;
    if (submissionId) {
      const editResponse = safeBusinessResult(
        await this.request(
          session,
          "GET",
          `/gateway/bxb/student/activity-work-correct/${submissionId}`,
        ),
        "activity-work-correct",
      );
      payload = ensureObject(editResponse.data);
    } else {
      payload = {
        activityId: taskId,
        childrenId: userInfo.id,
        classId: curSubject.classId,
        remark: "",
        id: null,
        isCorrectWork: 0,
        fileList: [],
      };
    }

    payload.activityId = payload.activityId || taskId;
    payload.childrenId = payload.childrenId || userInfo.id;
    payload.classId = payload.classId || curSubject.classId;
    payload.isCorrectWork = isCorrectWork;
    payload.remark = remark;
    payload.fileList = [
      ...toArray(payload.fileList),
      ...fileIds.map((fileId) => ({ fileId: normalizeId(fileId) })),
      ...uploadedFiles,
    ];

    if (!String(payload.remark || "").trim() && payload.fileList.length === 0) {
      throw new Error("内容和附件不能都为空");
    }

    const result = safeBusinessResult(
      await this.request(session, "PUT", "/gateway/bxb/activityUser/receipt", {
        body: payload,
      }),
      "activityUser/receipt",
    );

    await this.refreshContext(session);

    return {
      context: this.summarizeSession(session),
      taskId: normalizeId(taskId),
      submissionId: normalizeId(payload.id || submissionId),
      uploadedCount: uploadedFiles.length,
      fileCount: payload.fileList.length,
      remarkLength: String(payload.remark || "").length,
      result: result.data ?? result,
    };
  }

  async browserCaptureAchievementPage({
    headless = true,
    screenshotPath = path.join(process.cwd(), "artifacts", "achievement-page.png"),
  } = {}) {
    const session = await this.requireSession();
    let browser;
    browser = await launchBrowser(headless);

    try {
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      const context = await browser.newContext();

      await context.addInitScript((storage) => {
        for (const [key, value] of Object.entries(storage)) {
          if (typeof value === "string") {
            localStorage.setItem(key, value);
          }
        }
      }, session.storage);

      const page = await context.newPage();
      await page.goto(`${session.baseUrl || BASE_URL}/achievement_list`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const bodyText = await page.locator("body").innerText();

      return {
        url: page.url(),
        title: await page.title(),
        screenshotPath,
        redirectedToLogin: page.url().includes("/login"),
        textPreview: bodyText.slice(0, 1200),
      };
    } finally {
      await browser?.close();
    }
  }

  async webSearch({ query, maxResults = 5, engine = "bing", timeoutMs = 20000 } = {}) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      throw new Error("Search query cannot be empty.");
    }

    const normalizedEngine = normalizeSearchEngine(engine);
    const limit = clampInt(maxResults, 5, { min: 1, max: 10 });
    const timeout = clampInt(timeoutMs, 20000, { min: 5000, max: 45000 });

    const rssUrl = new URL("https://www.bing.com/search");
    rssUrl.searchParams.set("q", normalizedQuery);
    rssUrl.searchParams.set("format", "rss");
    rssUrl.searchParams.set("setlang", "zh-CN");
    rssUrl.searchParams.set("cc", "CN");

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(rssUrl, {
        signal: controller.signal,
        headers: {
          Accept: "application/rss+xml,text/xml,*/*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        },
      });
      const xml = await response.text();
      clearTimeout(timer);

      if (response.ok) {
        const results = parseBingRssResults(xml, limit);
        if (results.length > 0) {
          return {
            query: normalizedQuery,
            engine: normalizedEngine,
            mode: "bing-rss",
            url: rssUrl.toString(),
            count: results.length,
            results,
            note:
              "Results were collected from Bing's RSS search endpoint. Use read_web_page for a selected result when more detail is needed.",
          };
        }
      }
    } catch {
      // Fall through to browser-based search below.
    }

    const searchUrl = new URL("https://www.bing.com/search");
    searchUrl.searchParams.set("q", normalizedQuery);
    searchUrl.searchParams.set("setlang", "zh-CN");
    searchUrl.searchParams.set("cc", "CN");

    let browser;
    browser = await launchBrowser(true);

    try {
      const context = await browser.newContext({
        locale: "zh-CN",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      });
      const page = await context.newPage();
      await page.goto(searchUrl.toString(), {
        waitUntil: "domcontentloaded",
        timeout,
      });
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 10000) }).catch(() => {});

      const results = await page.evaluate((maxItems) => {
        const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim();
        const rows = Array.from(document.querySelectorAll("li.b_algo"));
        return rows
          .map((row) => {
            const link = row.querySelector("h2 a");
            const href = link?.href || "";
            const title = cleanText(link?.textContent);
            const snippet =
              cleanText(row.querySelector(".b_caption p")?.textContent) ||
              cleanText(row.querySelector("p")?.textContent) ||
              cleanText(row.querySelector(".b_snippet")?.textContent);

            return { title, url: href, snippet };
          })
          .filter((item) => item.title && /^https?:\/\//i.test(item.url))
          .slice(0, maxItems);
      }, limit);

      return {
        query: normalizedQuery,
        engine: normalizedEngine,
        url: page.url(),
        count: results.length,
        results,
        note:
          results.length > 0
            ? "Results were collected through the local browser. Use read_web_page for a selected result when more detail is needed."
            : "No search results were parsed. Bing may have changed its page layout, blocked automation, or returned an interstitial page.",
      };
    } finally {
      await browser?.close();
    }
  }

  async readWebPage({ url, maxChars = 8000, timeoutMs = 20000 } = {}) {
    const targetUrl = normalizeHttpUrl(url);
    const limit = clampInt(maxChars, 8000, { min: 500, max: 30000 });
    const timeout = clampInt(timeoutMs, 20000, { min: 5000, max: 45000 });

    let browser;
    browser = await launchBrowser(true);

    try {
      const context = await browser.newContext({
        locale: "zh-CN",
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      });
      const page = await context.newPage();
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout,
      });
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 10000) }).catch(() => {});

      const pageText = await page.evaluate(() => document.body?.innerText || "");
      const preview = buildTextPreview(pageText, limit);
      return {
        url: targetUrl,
        finalUrl: page.url(),
        title: await page.title(),
        text: preview.text,
        truncated: preview.truncated,
        totalChars: preview.totalChars,
      };
    } finally {
      await browser?.close();
    }
  }
}
