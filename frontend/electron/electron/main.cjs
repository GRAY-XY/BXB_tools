const { app, BrowserWindow, dialog, ipcMain, net, shell, Notification } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createReadStream, createWriteStream, existsSync, readdirSync } = require("node:fs");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const isDev = !app.isPackaged;
const isMac = process.platform === "darwin";
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const payloadRoot = isDev ? repoRoot : path.join(process.resourcesPath, "payload");
const userDataRoot = app.getPath("userData");
const dataRoot = path.join(userDataRoot, ".banxuebang");
const workspaceDir = path.join(dataRoot, "workspace");
const draftDir = path.join(dataRoot, "drafts");
const updateDir = path.join(userDataRoot, "updates");
const pendingUpdatePath = path.join(updateDir, "pending-update.json");
const modelConfigPath = path.join(userDataRoot, "model-config.json");
const featureConfigPath = path.join(userDataRoot, "feature-config.json");
const conversationsPath = path.join(userDataRoot, "agent-conversations.json");
const alertStatePath = path.join(userDataRoot, "alert-state.json");
const reviewDir = path.join(userDataRoot, "review");
const reviewIndexPath = path.join(reviewDir, "index.json");
const courseModesPath = path.join(userDataRoot, "course-modes.json");
const { loadFeatureConfig, saveFeatureConfig } = require("./feature-config.cjs");
const { evaluateGpaAlert, evaluateReminders, loadAlertState, saveAlertState } = require("./alerts.cjs");
const { MODE_LABELS, loadCourseModes, saveCourseMode, modeFor, generateDraftForTask } = require("./auto-pipeline.cjs");
const IMAGE_MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".avif", "image/avif"],
]);
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PASTED_FILE_BYTES = 25 * 1024 * 1024;
const PASTED_IMAGE_EXTENSION_BY_MIME = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
  ["image/avif", ".avif"],
]);
const RELEASES_API_URL = "https://api.github.com/repos/GRAY-XY/BXB_tools/releases?per_page=30";
const RELEASES_PAGE_URL = "https://github.com/GRAY-XY/BXB_tools/releases";
const WINDOWS_RELEASE_TITLE_PREFIX = "BXB Homework v";
const LEGACY_WINDOWS_PREVIEW_TITLE_PREFIX = "BXB Homework Win v";
const DEFAULT_SYSTEM_PROMPT =
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交、私信或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。如果作业已过期且可能无法补交，可以在草稿提示字段中建议用户私信老师，但只能保存草稿等待用户审核。给出或保存草稿正文时，draft_text 必须是纯文本正文，不要使用 Markdown 标题、列表、表格、代码块、加粗、引用或其他 Markdown 格式；如果需要给用户说明保存状态，可以在助手回复里用 Markdown，但草稿正文内容本身必须保持纯文本。";
const LEGACY_DEFAULT_SYSTEM_PROMPTS = new Set([
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。",
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。",
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。",
]);

let mainWindow = null;
let toolRuntimePromise = null;
let conversationStatePromise = null;
let updateDownloadController = null;
let updateState = {
  status: "idle",
  update: null,
  downloadedBytes: 0,
  totalBytes: 0,
  percent: 0,
  filePath: null,
  message: "",
};

function safeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || "",
  };
}

function parseAppVersion(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-pre(?:\.(\d+))?)?$/);
  if (!match) {
    return null;
  }
  return {
    raw: text,
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    preview: text.includes("-pre"),
    preNumber: match[4] ? Number.parseInt(match[4], 10) : 0,
  };
}

function compareAppVersions(left, right) {
  const leftParsed = typeof left === "string" ? parseAppVersion(left) : left;
  const rightParsed = typeof right === "string" ? parseAppVersion(right) : right;
  if (!leftParsed || !rightParsed) {
    return 0;
  }

  for (const key of ["major", "minor", "patch"]) {
    if (leftParsed[key] !== rightParsed[key]) {
      return leftParsed[key] > rightParsed[key] ? 1 : -1;
    }
  }

  if (leftParsed.preview !== rightParsed.preview) {
    return leftParsed.preview ? -1 : 1;
  }

  if (leftParsed.preNumber !== rightParsed.preNumber) {
    return leftParsed.preNumber > rightParsed.preNumber ? 1 : -1;
  }

  return 0;
}

function extractWindowsReleaseVersion(release) {
  const title = String(release?.name || "").trim();
  const version = title.startsWith(WINDOWS_RELEASE_TITLE_PREFIX)
    ? title.slice(WINDOWS_RELEASE_TITLE_PREFIX.length).trim()
    : title.startsWith(LEGACY_WINDOWS_PREVIEW_TITLE_PREFIX)
      ? title.slice(LEGACY_WINDOWS_PREVIEW_TITLE_PREFIX.length).trim()
      : null;
  if (!version) return null;
  return parseAppVersion(version);
}

function chooseWindowsInstallerAsset(release, version) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const installers = assets.filter((asset) => {
    const name = String(asset?.name || "").toLowerCase();
    return name.endsWith(".exe") && !name.endsWith(".blockmap");
  });
  if (!installers.length) {
    return null;
  }

  const normalizedVersion = String(version || "").toLowerCase();
  return (
    installers.find((asset) => String(asset?.name || "").toLowerCase().includes(normalizedVersion)) ||
    installers[0]
  );
}

function chooseWindowsSha256Asset(release, installerAsset) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const installerName = String(installerAsset?.name || "").toLowerCase();
  const expectedName = installerName ? `${installerName}.sha256` : "";
  return (
    assets.find((asset) => String(asset?.name || "").toLowerCase() === expectedName) ||
    assets.find((asset) => String(asset?.name || "").toLowerCase().endsWith(".sha256")) ||
    null
  );
}

function sanitizeFileName(value) {
  return String(value || "download.exe").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
}

function publicUpdateState() {
  return {
    ...updateState,
    update: updateState.update ? { ...updateState.update } : null,
  };
}

function setUpdateState(patch) {
  updateState = {
    ...updateState,
    ...patch,
  };
  if (mainWindow) {
    mainWindow.webContents.send("update:progress", publicUpdateState());
  }
  return publicUpdateState();
}

function resetUpdateProgress(patch = {}) {
  return setUpdateState({
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    filePath: null,
    message: "",
    ...patch,
  });
}

function assertUpdateCacheFile(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const root = path.resolve(updateDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("更新文件不在应用更新缓存目录中。");
  }
  if (path.extname(resolved).toLowerCase() !== ".exe") {
    throw new Error("更新安装器必须是 .exe 文件。");
  }
  return resolved;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function readSha256Asset(downloadUrl) {
  if (!downloadUrl) {
    throw new Error("Release 缺少 SHA256 校验文件。");
  }
  const response = await net.fetch(downloadUrl, {
    headers: { "User-Agent": "BXB-Homework" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SHA256 校验文件下载失败 HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const match = text.match(/[a-fA-F0-9]{64}/);
  if (!match) {
    throw new Error("SHA256 校验文件格式无效。");
  }
  return match[0].toLowerCase();
}

async function writeResponseBodyToFile(response, filePath, totalBytes) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(filePath, buffer);
    setUpdateState({
      downloadedBytes: buffer.byteLength,
      totalBytes: totalBytes || buffer.byteLength,
      percent: 100,
    });
    return buffer.byteLength;
  }

  const reader = response.body.getReader();
  const output = createWriteStream(filePath);
  let downloadedBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      downloadedBytes += chunk.byteLength;
      if (!output.write(chunk)) {
        await new Promise((resolve, reject) => {
          output.once("drain", resolve);
          output.once("error", reject);
        });
      }
      setUpdateState({
        downloadedBytes,
        totalBytes,
        percent: totalBytes ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0,
      });
    }
  } finally {
    await new Promise((resolve, reject) => {
      output.end((error) => (error ? reject(error) : resolve()));
    });
  }
  return downloadedBytes;
}

function nowIso() {
  return new Date().toISOString();
}

function newConversation(title = "新对话") {
  const timestamp = nowIso();
  return {
    id: `conv_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    turns: [],
  };
}

function normalizeConversation(raw) {
  const fallback = newConversation();
  return {
    id: String(raw?.id || fallback.id),
    title: String(raw?.title || "新对话").trim() || "新对话",
    createdAt: String(raw?.createdAt || fallback.createdAt),
    updatedAt: String(raw?.updatedAt || raw?.createdAt || fallback.updatedAt),
    messages: Array.isArray(raw?.messages) ? raw.messages : [],
    turns: Array.isArray(raw?.turns) ? raw.turns : [],
  };
}

function conversationSummary(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
  };
}

function conversationForRenderer(conversation) {
  if (!conversation) {
    return null;
  }
  return {
    ...conversationSummary(conversation),
    messages: conversation.messages,
  };
}

async function loadConversationState() {
  if (conversationStatePromise) {
    return conversationStatePromise;
  }

  conversationStatePromise = (async () => {
    const stored = await readJson(conversationsPath, null);
    const conversations = Array.isArray(stored?.conversations)
      ? stored.conversations.map(normalizeConversation)
      : [];
    if (!conversations.length) {
      conversations.push(newConversation());
    }
    const activeId = conversations.some((item) => item.id === stored?.activeId)
      ? stored.activeId
      : conversations[0].id;
    return { activeId, conversations };
  })();

  return conversationStatePromise;
}

async function saveConversationState(state) {
  state.conversations.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  await writeJson(conversationsPath, state);
  return state;
}

async function getActiveConversation(conversationId) {
  const state = await loadConversationState();
  const targetId = conversationId || state.activeId;
  let conversation = state.conversations.find((item) => item.id === targetId);
  if (!conversation) {
    conversation = newConversation();
    state.conversations.unshift(conversation);
    state.activeId = conversation.id;
    await saveConversationState(state);
  }
  return { state, conversation };
}

async function listConversations() {
  const state = await loadConversationState();
  const active = state.conversations.find((item) => item.id === state.activeId) || state.conversations[0];
  return {
    activeId: active?.id || null,
    conversations: state.conversations.map(conversationSummary),
    activeConversation: conversationForRenderer(active),
  };
}

async function createConversation(title = "新对话") {
  const state = await loadConversationState();
  const conversation = newConversation(title);
  state.conversations.unshift(conversation);
  state.activeId = conversation.id;
  await saveConversationState(state);
  return listConversations();
}

async function selectConversation(conversationId) {
  const state = await loadConversationState();
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    throw new Error("找不到指定对话。");
  }
  state.activeId = conversation.id;
  await saveConversationState(state);
  return listConversations();
}

async function renameConversation(conversationId, title) {
  const state = await loadConversationState();
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    throw new Error("找不到指定对话。");
  }
  conversation.title = String(title || "").trim() || "未命名对话";
  conversation.updatedAt = nowIso();
  await saveConversationState(state);
  return listConversations();
}

async function deleteConversation(conversationId) {
  const state = await loadConversationState();
  state.conversations = state.conversations.filter((item) => item.id !== conversationId);
  if (!state.conversations.length) {
    state.conversations.push(newConversation());
  }
  if (!state.conversations.some((item) => item.id === state.activeId)) {
    state.activeId = state.conversations[0].id;
  }
  await saveConversationState(state);
  return listConversations();
}

function maskKey(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (text.length <= 8) {
    return `${text.slice(0, 2)}****`;
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function deriveChatUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  if (normalized.endsWith("/models")) {
    return `${normalized.slice(0, -"/models".length)}/chat/completions`;
  }
  if (/\/v\d+$/.test(normalized)) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

function deriveModelsUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (normalized.endsWith("/models")) {
    return normalized;
  }
  if (normalized.endsWith("/chat/completions")) {
    return `${normalized.slice(0, -"/chat/completions".length)}/models`;
  }
  if (/\/v\d+$/.test(normalized)) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
}

function browserCacheCandidates() {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(userDataRoot, "ms-playwright"),
    path.join(app.getPath("appData"), "ms-playwright"),
  ];
  if (process.platform === "darwin") {
    candidates.push(path.join(app.getPath("home"), "Library", "Caches", "ms-playwright"));
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "ms-playwright"));
  }
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, "AppData", "Local", "ms-playwright"));
  }
  return [...new Set(candidates.filter(Boolean).map((item) => path.resolve(item)))];
}

function hasChromiumCache(browserRoot) {
  if (process.platform === "darwin") {
    let entries = [];
    try {
      entries = readdirSync(browserRoot);
    } catch {
      entries = [];
    }
    return entries.some((entry) => {
      const root = path.join(browserRoot, entry);
      if (entry.startsWith("chromium-")) {
        return (
          existsSync(path.join(root, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")) ||
          existsSync(path.join(root, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"))
        );
      }
      if (entry.startsWith("chromium_headless_shell-")) {
        return existsSync(path.join(root, "chrome-mac", "headless_shell"));
      }
      return false;
    });
  }
  let entries = [];
  try {
    entries = readdirSync(browserRoot);
  } catch {
    entries = [];
  }
  return entries.some((entry) => {
    if (!entry.startsWith("chromium-")) return false;
    const root = path.join(browserRoot, entry);
    return (
      existsSync(path.join(root, "chrome-win64", "chrome.exe")) ||
      existsSync(path.join(root, "chrome-win", "chrome.exe"))
    );
  });
}

function findExistingBrowserRoot() {
  return browserCacheCandidates().find((candidate) => hasChromiumCache(candidate)) || null;
}

function getBrowserDependencyStatus() {
  const existingRoot = findExistingBrowserRoot();
  return {
    ready: Boolean(existingRoot),
    browserRoot: existingRoot || path.join(userDataRoot, "ms-playwright"),
    candidates: browserCacheCandidates(),
    source: existingRoot ? "existing-cache" : "missing",
  };
}

function appPathTargets() {
  const browserDependency = getBrowserDependencyStatus();
  return {
    userDataRoot: { path: userDataRoot, kind: "directory", ensure: true },
    dataRoot: { path: dataRoot, kind: "directory", ensure: true },
    workspaceDir: { path: workspaceDir, kind: "directory", ensure: true },
    draftDir: { path: draftDir, kind: "directory", ensure: true },
    updateDir: { path: updateDir, kind: "directory", ensure: true },
    modelConfigPath: { path: modelConfigPath, kind: "file", ensureParent: true },
    conversationsPath: { path: conversationsPath, kind: "file", ensureParent: true },
    payloadRoot: { path: payloadRoot, kind: "directory", ensure: false },
    browserRoot: { path: browserDependency.browserRoot, kind: "directory", ensure: false },
  };
}

async function openAppPath(key) {
  const target = appPathTargets()[String(key || "")];
  if (!target?.path) {
    throw new Error("未知路径。");
  }

  if (target.kind === "file") {
    const parent = path.dirname(target.path);
    if (target.ensureParent) {
      await fs.mkdir(parent, { recursive: true });
    }
    if (existsSync(target.path)) {
      shell.showItemInFolder(target.path);
      return { ok: true, key, path: target.path };
    }
    const error = await shell.openPath(parent);
    if (error) {
      throw new Error(error);
    }
    return { ok: true, key, path: parent };
  }

  if (target.ensure) {
    await fs.mkdir(target.path, { recursive: true });
  }
  const error = await shell.openPath(target.path);
  if (error) {
    throw new Error(error);
  }
  return { ok: true, key, path: target.path };
}

async function ensurePlaywrightBrowsers() {
  const existingRoot = findExistingBrowserRoot();
  if (existingRoot) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = existingRoot;
    return getBrowserDependencyStatus();
  }

  const browserRoot = path.join(userDataRoot, "ms-playwright");
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
  const zipPath = path.join(payloadRoot, "runtime", "ms-playwright-browsers.zip");
  if (!existsSync(zipPath)) {
    return getBrowserDependencyStatus();
  }

  await fs.mkdir(browserRoot, { recursive: true });
  const command = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${browserRoot.replaceAll("'", "''")}' -Force`,
  ];
  const result = spawnSync("powershell", command, { windowsHide: true, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`无法解压浏览器依赖：${result.stderr || result.stdout}`);
  }
  const status = getBrowserDependencyStatus();
  if (!status.ready) {
    throw new Error(`浏览器依赖已尝试解压，但没有找到 Chromium 可执行文件。解压目录：${browserRoot}`);
  }
  return status;
}

async function getToolRuntime() {
  if (toolRuntimePromise) {
    return toolRuntimePromise;
  }

  toolRuntimePromise = (async () => {
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.mkdir(workspaceDir, { recursive: true });
    process.env.BANXUEBANG_SESSION_FILE = path.join(dataRoot, "session.json");
    process.env.BANXUEBANG_DRAFT_DIR = draftDir;
    process.env.BANXUEBANG_WORKSPACE_DIR = workspaceDir;

    const srcRoot = path.join(payloadRoot, "backend", "src");
    const [{ BanxuebangClient }, { SessionStore }, { createToolDefinitions, executeTool }] = await Promise.all([
      import(pathToFileURL(path.join(srcRoot, "banxuebang-client.js")).href),
      import(pathToFileURL(path.join(srcRoot, "session-store.js")).href),
      import(pathToFileURL(path.join(srcRoot, "tool-definitions.js")).href),
    ]);

    const client = new BanxuebangClient(new SessionStore(process.env.BANXUEBANG_SESSION_FILE));
    const toolDefinitions = createToolDefinitions(client);
    return { client, toolDefinitions, executeTool };
  })();

  return toolRuntimePromise;
}

async function callTool(name, args = {}) {
  if (
    [
      "interactive_login",
      "login_in_browser",
      "login_with_credentials",
      "browser_capture_achievement_page",
      "web_search",
      "read_web_page",
    ].includes(name)
  ) {
    await ensurePlaywrightBrowsers();
  }
  await applyRuntimeEnv();
  const { toolDefinitions, executeTool } = await getToolRuntime();
  return executeTool(toolDefinitions, name, args || {});
}

async function applyRuntimeEnv() {
  const [featureConfig, modelConfig] = await Promise.all([
    loadFeatureConfig(featureConfigPath),
    readJson(modelConfigPath, { apiKey: "", baseUrl: "", modelName: "" }),
  ]);
  process.env.BANXUEBANG_OCR_ENABLED = featureConfig.ocr ? "1" : "0";
  process.env.BANXUEBANG_MODEL_BASE_URL = String(modelConfig.baseUrl || "");
  process.env.BANXUEBANG_MODEL_API_KEY = String(modelConfig.apiKey || "");
  process.env.BANXUEBANG_MODEL_NAME = String(modelConfig.modelName || "");
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function showLocalNotification(title, body) {
  if (!isMac && !Notification.isSupported()) {
    return;
  }
  new Notification({ title, body }).show();
}

async function collectGpaAlerts() {
  const config = await loadFeatureConfig(featureConfigPath);
  if (!config.gpaAlert) {
    return [];
  }
  await applyRuntimeEnv();
  const { client } = await getToolRuntime();
  const session = await client.getSession();
  const subjects = Array.isArray(session?.context?.subjectList) ? session.context.subjectList : [];
  const alerts = [];
  for (const subject of subjects) {
    if (!subject?.id) {
      continue;
    }
    try {
      const overview = await client.getAchievementOverview({ subjectId: subject.id, classId: subject.classId });
      alerts.push(...evaluateGpaAlert(overview, config.gpaThreshold));
    } catch {
      // 单个学科查询失败不影响其他学科
    }
  }
  return alerts;
}

async function notifyGpaIfNeeded() {
  const config = await loadFeatureConfig(featureConfigPath);
  if (!config.gpaAlert || !config.notifications) {
    return [];
  }
  const alerts = await collectGpaAlerts();
  const state = await loadAlertState(alertStatePath);
  const changed = { ...state, gpaNotified: { ...(state.gpaNotified || {}) } };
  const today = todayKey();
  for (const alert of alerts) {
    const key = `${alert.subject}:${alert.level}`;
    if (alert.dangerous && changed.gpaNotified[key] !== today) {
      changed.gpaNotified[key] = today;
      showLocalNotification("GPA 预警", `${alert.subject} 当前等级 ${alert.level}，已达到危险线（${config.gpaThreshold} 及以下）。`);
    }
  }
  await saveAlertState(alertStatePath, changed);
  return alerts;
}

async function notifyRemindersIfNeeded() {
  const config = await loadFeatureConfig(featureConfigPath);
  if (!config.reminder || !config.notifications) {
    return [];
  }
  let tasks;
  try {
    tasks = await callTool("list_tasks", { subject_name: "全部课程", list_type: "pending", size: 100 });
  } catch {
    return [];
  }
  const list = Array.isArray(tasks?.unsubmittedHomeworkList)
    ? tasks.unsubmittedHomeworkList
    : Array.isArray(tasks?.homeworkList)
      ? tasks.homeworkList
      : [];
  const reminders = evaluateReminders(list, new Date(), config.remindLeadHours);
  const state = await loadAlertState(alertStatePath);
  const changed = { ...state, remindersNotified: { ...(state.remindersNotified || {}) } };
  const today = todayKey();
  for (const item of reminders) {
    const key = `${item.taskId}:${item.status}`;
    if (changed.remindersNotified[key] !== today) {
      changed.remindersNotified[key] = today;
      const body =
        item.status === "overdue"
          ? `「${item.title}」已逾期未交，请尽快处理。`
          : `「${item.title}」还剩约 ${item.hoursLeft} 小时截止，记得提交。`;
      showLocalNotification("未交作业提醒", body);
    }
  }
  await saveAlertState(alertStatePath, changed);
  return reminders;
}

async function getAlertSummary() {
  const config = await loadFeatureConfig(featureConfigPath);
  const summary = { gpa: [], reminders: [] };
  if (config.gpaAlert) {
    try {
      summary.gpa = await collectGpaAlerts();
    } catch {
      summary.gpa = [];
    }
  }
  if (config.reminder) {
    try {
      const tasks = await callTool("list_tasks", { subject_name: "全部课程", list_type: "pending", size: 100 });
      const list = Array.isArray(tasks?.unsubmittedHomeworkList)
        ? tasks.unsubmittedHomeworkList
        : Array.isArray(tasks?.homeworkList)
          ? tasks.homeworkList
          : [];
      summary.reminders = evaluateReminders(list, new Date(), config.remindLeadHours);
    } catch {
      summary.reminders = [];
    }
  }
  return summary;
}

async function runAlertChecks() {
  try {
    await notifyGpaIfNeeded();
    await notifyRemindersIfNeeded();
    await runAutoCompleteOnce();
  } catch (error) {
    console.error("Alert check failed:", error.message);
  }
}

function scheduleAlertChecks() {
  setTimeout(() => {
    runAlertChecks();
  }, 8000);
  setInterval(() => {
    runAlertChecks();
  }, Math.max(5, Number(10)) * 60 * 1000);
}

async function getKnowledgeEngine() {
  const { collectTaskKnowledge, aggregateBySubject, sanitizeTopicName } = await import(
    pathToFileURL(path.join(payloadRoot, "backend", "src", "knowledge-engine.js")).href
  );
  return { collectTaskKnowledge, aggregateBySubject, sanitizeTopicName };
}

async function refreshKnowledge() {
  const config = await loadFeatureConfig(featureConfigPath);
  if (!config.knowledgeReview) {
    return { ok: false, reason: "知识点复习已关闭，请先在设置中打开。" };
  }
  await applyRuntimeEnv();
  const { client } = await getToolRuntime();
  const tasksResult = await client.listTasks({ subjectName: "全部课程", listType: "all", size: 100 });
  const list = Array.isArray(tasksResult?.homeworkList) ? tasksResult.homeworkList : [];
  const taskIds = list.map((item) => item.id).filter(Boolean);
  const { collectTaskKnowledge, aggregateBySubject, sanitizeTopicName } = await getKnowledgeEngine();
  const { entries, skipped } = await collectTaskKnowledge(client, taskIds);
  const groups = aggregateBySubject(entries);
  const subjects = [];
  await fs.mkdir(reviewDir, { recursive: true });
  for (const group of groups) {
    const safeSubject = sanitizeTopicName(group.subject);
    const notes = [];
    for (const entry of group.items) {
      const safeTitle = sanitizeTopicName(entry.title);
      const fileName = `${safeTitle}.md`;
      const notePath = path.join(reviewDir, safeSubject, fileName);
      await fs.mkdir(path.dirname(notePath), { recursive: true });
      await fs.writeFile(notePath, `# ${entry.title}\n\n> 来源作业：${entry.taskId}\n\n${entry.text}\n`, "utf8");
      notes.push({ topic: entry.title, file: `${safeSubject}/${fileName}`, sourceTaskIds: [entry.taskId] });
    }
    subjects.push({ subject: group.subject, notes });
  }
  const index = { updatedAt: new Date().toISOString(), subjects };
  await fs.writeFile(reviewIndexPath, JSON.stringify(index, null, 2), "utf8");
  return { ok: true, count: entries.length, skipped: skipped.length, index };
}

async function listReviewNotes() {
  try {
    return JSON.parse(await fs.readFile(reviewIndexPath, "utf8"));
  } catch {
    return null;
  }
}

async function readReviewNote(relativePath) {
  const resolved = path.resolve(reviewDir, String(relativePath || ""));
  if (resolved !== reviewDir && !resolved.startsWith(reviewDir + path.sep)) {
    throw new Error("无效的复习笔记路径。");
  }
  return fs.readFile(resolved, "utf8");
}

async function summarizeReviewWithModel() {
  const index = await listReviewNotes();
  if (!index?.subjects?.length) {
    return { ok: false, reason: "没有可总结的复习笔记，请先整理知识点。" };
  }
  const modelConfig = await readJson(modelConfigPath, { apiKey: "", baseUrl: "", modelName: "" });
  if (!modelConfig.apiKey || !modelConfig.baseUrl || !modelConfig.modelName) {
    return { ok: false, reason: "未配置模型，请先在设置中填写 API Key、调用链接和模型名称。" };
  }
  const { sanitizeTopicName } = await getKnowledgeEngine();
  const summaries = [];
  for (const group of index.subjects) {
    const texts = [];
    for (const note of group.notes.slice(0, 8)) {
      try {
        texts.push(await readReviewNote(note.file));
      } catch {
        // 跳过不可读笔记
      }
    }
    const contentInput = texts.join("\n\n---\n\n").slice(0, 12000);
    const response = await fetch(deriveChatUrl(modelConfig.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${modelConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: modelConfig.modelName,
        messages: [
          { role: "system", content: "你是学习助手。输出简洁的中文知识点复习卡片，使用 Markdown 小节：概念、公式或要点、例题、易错点。" },
          { role: "user", content: `请把下面的作业内容总结成复习卡片：\n\n${contentInput}` },
        ],
        temperature: 0.3,
      }),
    });
    if (!response.ok) {
      throw new Error(`模型返回 HTTP ${response.status}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content || "";
    if (!content) {
      throw new Error("模型没有返回总结内容。");
    }
    const safeSubject = sanitizeTopicName(group.subject);
    const summaryPath = path.join(reviewDir, safeSubject, "_summary.md");
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, `# ${group.subject} 复习总结\n\n${content}\n`, "utf8");
    summaries.push({ subject: group.subject, summaryFile: `${safeSubject}/_summary.md`, noteCount: group.notes.length });
  }
  const updatedIndex = { ...index, summarizedAt: new Date().toISOString(), summaries };
  await fs.writeFile(reviewIndexPath, JSON.stringify(updatedIndex, null, 2), "utf8");
  return { ok: true, summaries };
}

async function runAutoCompleteOnce() {
  const config = await loadFeatureConfig(featureConfigPath);
  if (!config.autoComplete) {
    return { skipped: true, reason: "AI 自动完成已关闭" };
  }
  const modelConfig = await readJson(modelConfigPath, { apiKey: "", baseUrl: "", modelName: "" });
  if (!modelConfig.apiKey || !modelConfig.baseUrl || !modelConfig.modelName) {
    return { skipped: true, reason: "未配置模型" };
  }
  const { client } = await getToolRuntime();
  await applyRuntimeEnv();
  const tasksResult = await client.listTasks({ subjectName: "全部课程", listType: "pending", size: 50 });
  const list = Array.isArray(tasksResult?.unsubmittedHomeworkList)
    ? tasksResult.unsubmittedHomeworkList
    : Array.isArray(tasksResult?.homeworkList)
      ? tasksResult.homeworkList
      : [];
  const modes = await loadCourseModes(courseModesPath);
  const state = await loadAlertState(alertStatePath);
  const autoState = { ...(state.autoComplete || {}) };
  const today = todayKey();
  let generated = 0;
  for (const task of list) {
    const courseId = String(task.subjectId || task.courseId || task.classId || "");
    const mode = modeFor(modes, courseId);
    if (mode === "draft" || autoState[String(task.id)] === today) {
      continue;
    }
    try {
      const draftResult = await generateDraftForTask(client, task.id, modelConfig);
      if (!draftResult.ok) {
        autoState[String(task.id)] = today;
        continue;
      }
      const saved = await client.draftTaskSubmission({
        taskId: task.id,
        subjectName: task.subjectName || draftResult.detail.subjectName || null,
        taskTitle: task.title || null,
        draftText: draftResult.text,
        summary: "AI 自动生成草稿（实验版）",
        missingInfo: [],
        needsUserInput: false,
      });
      const draftId = saved?.draftId || saved?.id || null;
      if (mode === "auto" && draftId) {
        try {
          await client.approveSubmissionDraft(draftId, { reviewNote: "自动模式：已生成并标记待确认。" });
        } catch {
          // 标记失败不阻塞：草稿仍可人工审核
        }
      }
      autoState[String(task.id)] = today;
      generated += 1;
      showLocalNotification(
        "作业草稿已生成",
        `「${task.title || task.id}」的答案草稿已生成${mode === "auto" ? "并标记已审核" : ""}，请到草稿页确认后提交。`,
      );
    } catch (error) {
      console.error("Auto-complete failed for task", task.id, error.message);
    }
  }
  await saveAlertState(alertStatePath, { ...state, autoComplete: autoState });
  return { generated };
}

function normalizeSystemPrompt(value) {
  const prompt = String(value || "").trim();
  if (!prompt || LEGACY_DEFAULT_SYSTEM_PROMPTS.has(prompt)) {
    return DEFAULT_SYSTEM_PROMPT;
  }
  return prompt;
}

function extractModelIds(payload) {
  const rows = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];

  return rows
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      return String(item?.id || item?.name || item?.model || "").trim();
    })
    .filter(Boolean);
}

function modelRequiresTemperatureOne(config) {
  const baseUrl = String(config?.baseUrl || "").toLowerCase();
  const modelName = String(config?.modelName || "").toLowerCase();
  return baseUrl.includes("moonshot.cn") || modelName.startsWith("kimi-");
}

function chatTemperature(config, fallback) {
  return modelRequiresTemperatureOne(config) ? 1 : fallback;
}

function normalizeTemperature(value, fallback) {
  const temperature = Number.parseFloat(value);
  if (!Number.isFinite(temperature)) {
    return fallback;
  }
  return Math.min(2, Math.max(0, temperature));
}

function normalizeLongPasteThreshold(value, fallback = 4000) {
  const threshold = Number.parseInt(value, 10);
  if (!Number.isFinite(threshold)) {
    return fallback;
  }
  return Math.min(100000, Math.max(500, threshold));
}

async function loadModelConfig() {
  const config = await readJson(modelConfigPath, {
    apiKey: "",
    baseUrl: "",
    modelName: "",
    contextLength: 0,
    chatTemperature: 0.2,
    compactTemperature: 0.1,
    longPasteThreshold: 4000,
    maxToolRounds: 6,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    ...config,
    chatTemperature: normalizeTemperature(config.chatTemperature, 0.2),
    compactTemperature: normalizeTemperature(config.compactTemperature, 0.1),
    longPasteThreshold: normalizeLongPasteThreshold(config.longPasteThreshold, 4000),
    systemPrompt: normalizeSystemPrompt(config.systemPrompt),
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    apiKeyMasked: maskKey(config.apiKey),
    configPath: modelConfigPath,
  };
}

async function saveModelConfig(config) {
  const normalized = {
    apiKey: String(config?.apiKey || "").trim(),
    baseUrl: String(config?.baseUrl || "").trim(),
    modelName: String(config?.modelName || "").trim(),
    contextLength: Number.parseInt(config?.contextLength || 0, 10) || 0,
    chatTemperature: normalizeTemperature(config?.chatTemperature, 0.2),
    compactTemperature: normalizeTemperature(config?.compactTemperature, 0.1),
    longPasteThreshold: normalizeLongPasteThreshold(config?.longPasteThreshold, 4000),
    maxToolRounds: Math.max(1, Number.parseInt(config?.maxToolRounds || 6, 10) || 6),
    systemPrompt: normalizeSystemPrompt(config?.systemPrompt),
  };
  await writeJson(modelConfigPath, normalized);
  return loadModelConfig();
}

async function testModelConfig(config) {
  const candidate = await saveModelConfig(config);
  if (!candidate.apiKey || !candidate.baseUrl || !candidate.modelName) {
    throw new Error("请先填写 API Key、调用链接和模型名称。");
  }

  const listed = await listModelOptions(candidate);
  const modelIds = listed.modelIds;
  return {
    ok: modelIds.includes(candidate.modelName),
    modelsUrl: listed.modelsUrl,
    modelName: candidate.modelName,
    modelsCount: modelIds.length,
    sampleModels: modelIds.slice(0, 20),
    message: modelIds.includes(candidate.modelName)
      ? `连接成功，已找到模型 ${candidate.modelName}。`
      : `连接成功，但模型列表里没有找到 ${candidate.modelName}。`,
  };
}

async function listModelOptions(config) {
  const candidate = {
    apiKey: String(config?.apiKey || "").trim(),
    baseUrl: String(config?.baseUrl || "").trim(),
  };
  if (!candidate.baseUrl) {
    throw new Error("请先填写调用链接。");
  }

  const headers = {
    Accept: "application/json",
  };
  if (candidate.apiKey) {
    headers.Authorization = `Bearer ${candidate.apiKey}`;
  }

  const response = await fetch(deriveModelsUrl(candidate.baseUrl), { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`模型服务返回 HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  const payload = text ? JSON.parse(text) : {};
  const modelIds = extractModelIds(payload);
  return {
    modelsUrl: deriveModelsUrl(candidate.baseUrl),
    modelsCount: modelIds.length,
    modelIds,
    sampleModels: modelIds.slice(0, 20),
    message: modelIds.length ? `已读取 ${modelIds.length} 个模型。` : "连接成功，但没有读取到模型名称。",
  };
}

function toolSchemas() {
  return [
    { name: "session_status", description: "读取当前伴学邦登录状态和上下文。", parameters: { type: "object", properties: {} } },
    { name: "login_in_browser", description: "打开浏览器让用户手动登录伴学邦。", parameters: { type: "object", properties: {} } },
    { name: "refresh_context", description: "刷新当前伴学邦学期、班级、课程上下文。", parameters: { type: "object", properties: {} } },
    { name: "list_terms", description: "列出可用学期。", parameters: { type: "object", properties: {} } },
    {
      name: "set_current_term",
      description: "按学期名或 id 切换当前学期。",
      parameters: { type: "object", properties: { term_name: { type: "string" }, term_id: { type: "string" } } },
    },
    { name: "list_courses", description: "列出当前学期课程。", parameters: { type: "object", properties: {} } },
    {
      name: "set_current_subject",
      description: "按课程名称或 id 切换当前课程；subject_name 可传“全部课程”以聚合当前学期所有课程作业。",
      parameters: {
        type: "object",
        properties: {
          subject_name: { type: "string", description: "课程名称，例如 AP宏观经济学；传“全部课程”表示所有课程。" },
          subject_id: { type: "string" },
          class_id: { type: "string" },
        },
      },
    },
    {
      name: "list_tasks",
      description: "列出作业任务，可指定课程/学期和 pending/all/latest；当前课程为“全部课程”或 subject_name 为“全部课程”时聚合所有课程。",
      parameters: {
        type: "object",
        properties: {
          term_name: { type: "string" },
          subject_name: { type: "string", description: "可选课程名；传“全部课程”表示所有课程。" },
          list_type: { type: "string", enum: ["all", "latest", "pending"] },
          page: { type: "number" },
          size: { type: "number" },
        },
      },
    },
    {
      name: "open_task",
      description: "打开指定 task_id 的任务详情。",
      parameters: {
        type: "object",
        properties: { task_id: { type: "string" }, include_other_submissions: { type: "boolean" } },
        required: ["task_id"],
      },
    },
    {
      name: "read_task_content",
      description: "读取任务正文。",
      parameters: { type: "object", properties: { task_id: { type: "string" }, max_chars: { type: "number" } }, required: ["task_id"] },
    },
    { name: "get_current_subject_gpa", description: "读取当前课程平均 GPA/等级。", parameters: { type: "object", properties: {} } },
    {
      name: "get_achievement_overview",
      description: "读取当前课程成绩概览，包括平均等级、成绩项、转班记录和图表数据。",
      parameters: { type: "object", properties: { transfer_class_id: { type: "string" } } },
    },
    {
      name: "download_task_attachment",
      description: "下载任务附件到本地，通常用于后续读取 PDF/DOCX/文本附件。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          file_id: { type: "string" },
          directory: { type: "string" },
        },
        required: ["file_id"],
      },
    },
    {
      name: "read_task_attachment",
      description: "下载并读取任务附件文本，支持 txt/html/pdf/docx 等可解析格式。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          file_id: { type: "string" },
          max_chars: { type: "number" },
          directory: { type: "string" },
        },
        required: ["file_id"],
      },
    },
    {
      name: "list_workspace_files",
      description: "列出本地工作区文件。工作区保存用户导入文件，以及助手下载或创建的本地文件。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_files: { type: "number" },
        },
      },
    },
    {
      name: "read_workspace_file",
      description: "读取工作区文件内容，可按相对路径或文件名查找，支持文本、PDF、DOCX 等可读文件。",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string" },
          max_chars: { type: "number" },
        },
        required: ["file"],
      },
    },
    {
      name: "rename_workspace_file",
      description: "重命名工作区文件。new_name 如果没有扩展名，会保留原文件扩展名。",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string" },
          new_name: { type: "string" },
        },
        required: ["file", "new_name"],
      },
    },
    {
      name: "write_workspace_text_file",
      description: "在工作区创建文本或 Markdown 文件。只保存到本机，不会上传。",
      parameters: {
        type: "object",
        properties: {
          file_name: { type: "string" },
          content: { type: "string" },
          overwrite: { type: "boolean" },
        },
        required: ["file_name", "content"],
      },
    },
    {
      name: "extract_pdf_text",
      description: "从本地 PDF 文件提取文本。优先使用 download_task_attachment 返回的本地路径。",
      parameters: {
        type: "object",
        properties: { local_path: { type: "string" }, max_chars: { type: "number" } },
        required: ["local_path"],
      },
    },
    {
      name: "extract_docx_text",
      description: "从本地 DOCX 文件提取文本。优先使用 download_task_attachment 返回的本地路径。",
      parameters: {
        type: "object",
        properties: { local_path: { type: "string" }, max_chars: { type: "number" } },
        required: ["local_path"],
      },
    },
    {
      name: "run_python_snippet",
      description: "短时运行 Python 小程序做辅助计算或小规模数据处理。限制超时和输出长度，不是完整安全沙盒。",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string" },
          stdin: { type: "string" },
          timeout_ms: { type: "number" },
        },
        required: ["code"],
      },
    },
    {
      name: "web_search",
      description: "通过本机浏览器联网搜索，默认使用 Bing，不需要用户配置搜索 API Key。适合查询最新资料；回答时应引用返回结果中的链接。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          max_results: { type: "number", description: "默认 5，最多 10。" },
          engine: { type: "string", enum: ["bing"], description: "默认 bing。" },
          timeout_ms: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "read_web_page",
      description: "通过本机浏览器读取 http(s) 网页正文。通常先调用 web_search，再选择一个结果 URL 读取详情。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          max_chars: { type: "number", description: "默认 8000，最多 30000。" },
          timeout_ms: { type: "number" },
        },
        required: ["url"],
      },
    },
    {
      name: "collect_task_submission_context",
      description: "收集写作业草稿需要的任务正文、附件内容和缺失信息。",
      parameters: { type: "object", properties: { task_id: { type: "string" }, max_chars: { type: "number" } }, required: ["task_id"] },
    },
    {
      name: "draft_task_submission",
      description: "保存 AI 写好的提交草稿，等待用户审核；不会上传、提交或私信。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          subject_name: { type: "string" },
          task_title: { type: "string" },
          draft_text: { type: "string" },
          summary: { type: "string" },
          warnings: { type: "array", items: { type: "string" } },
          missing_info: { type: "array", items: { type: "string" } },
          needs_user_input: { type: "boolean" },
          preferred_target: { type: "string", enum: ["task", "teacher_private_message"] },
          intended_targets: { type: "array", items: { type: "string", enum: ["task", "teacher_private_message"] } },
          teacher_message_hint: { type: "string" },
        },
        required: ["task_id", "draft_text"],
      },
    },
    {
      name: "list_submission_drafts",
      description: "列出本地待审核草稿。",
      parameters: { type: "object", properties: { status: { type: "string" } } },
    },
    {
      name: "get_submission_draft",
      description: "读取一个待审核草稿。",
      parameters: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
    },
  ].map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

async function runAgent({ text, requestId, conversationId }) {
  const config = await loadModelConfig();
  if (!config.apiKey || !config.baseUrl || !config.modelName) {
    return {
      message: "还没有配置大模型。请先到“模型”页面填写 API Key、调用链接和模型名称。",
      steps: [],
      usage: null,
    };
  }
  const { state, conversation } = await getActiveConversation(conversationId);

  const steps = [];
  const pushStep = (kind, title, detail = "") => {
    const step = { kind, title, detail, at: new Date().toISOString() };
    steps.push(step);
    if (mainWindow && requestId) {
      mainWindow.webContents.send("agent:progress", { requestId, step });
    }
  };

  const maxToolRounds = Math.max(1, Number.parseInt(config.maxToolRounds || 6, 10));
  const messages = [
    {
      role: "system",
      content: String(config.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT,
    },
    ...conversation.turns,
    { role: "user", content: text },
  ];

  let usage = null;
  for (let index = 0; index < maxToolRounds; index += 1) {
    pushStep("llm", `第 ${index + 1} 轮请求模型`);
    const response = await fetch(deriveChatUrl(config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.modelName,
        messages,
        tools: toolSchemas(),
        tool_choice: "auto",
        temperature: chatTemperature(config, normalizeTemperature(config.chatTemperature, 0.2)),
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`模型服务返回 HTTP ${response.status}: ${raw.slice(0, 1200)}`);
    }
    const payload = raw ? JSON.parse(raw) : {};
    usage = payload.usage || usage;
    const message = payload?.choices?.[0]?.message || {};
    const toolCalls = message.tool_calls || [];

    if (!toolCalls.length) {
      const content = typeof message.content === "string" ? message.content : "执行完成。";
      const timestamp = nowIso();
      conversation.turns.push({ role: "user", content: text }, { role: "assistant", content });
      conversation.messages.push(
        { role: "user", text, at: timestamp },
        { role: "assistant", text: content, at: nowIso() },
      );
      if (conversation.title === "新对话") {
        conversation.title = text.slice(0, 28) || "新对话";
      }
      conversation.updatedAt = nowIso();
      state.activeId = conversation.id;
      await saveConversationState(state);
      pushStep("done", "模型已生成最终回答");
      return { message: content, steps, usage, conversation: conversationSummary(conversation) };
    }

    messages.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const toolName = call?.function?.name;
      const args = JSON.parse(call?.function?.arguments || "{}");
      pushStep("tool", `调用工具 ${toolName}`, JSON.stringify(args, null, 2));
      const result = await callTool(toolName, args);
      pushStep("tool", `工具 ${toolName} 已完成`, JSON.stringify(result, null, 2).slice(0, 4000));
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  throw new Error(`模型连续请求工具超过 ${maxToolRounds} 轮，仍未给出最终回答。`);
}

async function compactAgentContext(conversationId) {
  const config = await loadModelConfig();
  if (!config.apiKey || !config.baseUrl || !config.modelName) {
    throw new Error("还没有配置大模型，无法压缩上下文。");
  }
  const { state, conversation } = await getActiveConversation(conversationId);
  if (!conversation.turns.length) {
    return {
      ok: true,
      summary: "当前没有需要压缩的历史对话。",
      keptTurns: 0,
      previousTurns: 0,
      usage: null,
    };
  }

  const previousTurns = conversation.turns.length;
  const recentTurns = conversation.turns.slice(-6);
  const olderTurns = conversation.turns.slice(0, -6);
  const messages = [
    {
      role: "system",
      content:
        "你负责压缩伴学邦桌面助手的对话上下文。请用中文输出一份结构化摘要，保留用户目标、已确认事实、当前课程/任务/草稿ID、工具调用结论、待办、缺失信息和安全约束。不要编造，不要包含 API Key、登录令牌、密码或完整本地敏感路径。",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          olderConversation: olderTurns,
          recentConversation: recentTurns,
        },
        null,
        2,
      ),
    },
  ];

  const response = await fetch(deriveChatUrl(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelName,
      messages,
      temperature: chatTemperature(config, normalizeTemperature(config.compactTemperature, 0.1)),
    }),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`模型服务返回 HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  }
  const payload = raw ? JSON.parse(raw) : {};
  const summary = String(payload?.choices?.[0]?.message?.content || "").trim() || "历史对话已压缩。";
  conversation.turns = [
    {
      role: "system",
      content: `此前对话压缩摘要：\n${summary}`,
    },
    ...recentTurns,
  ];
  conversation.messages = [
    {
      role: "assistant",
      text: ["已压缩上下文，保留近期对话和关键任务信息。", "", summary].join("\n"),
      at: nowIso(),
    },
  ];
  conversation.updatedAt = nowIso();
  state.activeId = conversation.id;
  await saveConversationState(state);
  return {
    ok: true,
    summary,
    keptTurns: conversation.turns.length,
    previousTurns,
    usage: payload.usage || null,
    conversation: conversationSummary(conversation),
  };
}

function sanitizeWorkspaceImportName(filePath) {
  const baseName = path.basename(String(filePath || "file"));
  const cleaned = baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return cleaned || "file";
}

async function nextWorkspacePath(fileName) {
  await fs.mkdir(workspaceDir, { recursive: true });
  const parsed = path.parse(sanitizeWorkspaceImportName(fileName));
  let candidate = path.join(workspaceDir, `${parsed.name}${parsed.ext}`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(workspaceDir, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

async function importWorkspaceFiles() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "导入到工作区",
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled || !result.filePaths.length) {
    return { imported: [], canceled: true };
  }

  const imported = [];
  for (const sourcePath of result.filePaths) {
    const targetPath = await nextWorkspacePath(sourcePath);
    await fs.copyFile(sourcePath, targetPath);
    imported.push({
      name: path.basename(targetPath),
      path: targetPath,
      relativePath: path.relative(workspaceDir, targetPath).replaceAll("\\", "/"),
      sourcePath,
    });
  }

  return {
    imported,
    canceled: false,
  };
}

async function saveWorkspacePastes(items) {
  const entries = Array.isArray(items) ? items.slice(0, 20) : [];
  if (!entries.length) {
    return { saved: [] };
  }

  const saved = [];
  for (const entry of entries) {
    const kind = String(entry?.kind || "");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let fileName;
    let buffer;

    if (kind === "image") {
      const mimeType = String(entry?.mimeType || "").toLowerCase();
      const extension = PASTED_IMAGE_EXTENSION_BY_MIME.get(mimeType);
      if (!extension) {
        throw new Error(`不支持粘贴的图片类型：${mimeType || "未知类型"}`);
      }
      buffer = Buffer.from(entry?.bytes || []);
      if (!buffer.length || buffer.byteLength > MAX_PASTED_FILE_BYTES) {
        throw new Error("粘贴图片为空或超过 25 MB。");
      }
      const requestedName = sanitizeWorkspaceImportName(entry?.name || `pasted-image-${timestamp}${extension}`);
      fileName = `${path.parse(requestedName).name || `pasted-image-${timestamp}`}${extension}`;
    } else if (kind === "text") {
      const text = String(entry?.text || "");
      if (!text) {
        throw new Error("粘贴文本为空。");
      }
      buffer = Buffer.from(text, "utf8");
      if (buffer.byteLength > MAX_PASTED_FILE_BYTES) {
        throw new Error("粘贴文本超过 25 MB。");
      }
      const requestedName = sanitizeWorkspaceImportName(entry?.name || `pasted-text-${timestamp}.txt`);
      fileName = `${path.parse(requestedName).name || `pasted-text-${timestamp}`}.txt`;
    } else {
      throw new Error("只支持保存粘贴图片和长文本。");
    }

    const targetPath = await nextWorkspacePath(fileName);
    await fs.writeFile(targetPath, buffer);
    saved.push({
      kind,
      name: path.basename(targetPath),
      path: targetPath,
      relativePath: path.relative(workspaceDir, targetPath).replaceAll("\\", "/"),
      sizeBytes: buffer.byteLength,
      charCount: kind === "text" ? String(entry.text || "").length : null,
      mimeType: kind === "image" ? String(entry.mimeType || "") : "text/plain",
    });
  }

  return { saved };
}

function assertWorkspacePath(filePath) {
  const workspaceRoot = path.resolve(workspaceDir);
  const resolved = path.resolve(String(filePath || ""));
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Only workspace image files can be previewed.");
  }
  return resolved;
}

async function getWorkspaceImageDataUrl(filePath) {
  const resolved = assertWorkspacePath(filePath);
  const extension = path.extname(resolved).toLowerCase();
  const mimeType = IMAGE_MIME_BY_EXTENSION.get(extension);
  if (!mimeType) {
    throw new Error("This file type is not supported for image preview.");
  }

  const fileStat = await fs.stat(resolved);
  if (!fileStat.isFile()) {
    throw new Error("Image preview target is not a file.");
  }
  if (fileStat.size > MAX_INLINE_IMAGE_BYTES) {
    throw new Error("Image is too large to preview inline.");
  }

  const buffer = await fs.readFile(resolved);
  return {
    fileName: path.basename(resolved),
    path: resolved,
    mimeType,
    sizeBytes: buffer.byteLength,
    dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`,
  };
}

async function checkForUpdates() {
  if (isMac) {
    return {
      ok: true,
      currentVersion: app.getVersion(),
      currentChannel: "macOS preview",
      hasUpdate: false,
      message: "macOS 版本暂不提供自动更新。",
      releasesUrl: RELEASES_PAGE_URL,
    };
  }
  const currentVersion = app.getVersion();
  const currentParsed = parseAppVersion(currentVersion);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await net.fetch(RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "BXB-Homework",
      },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const releases = text ? JSON.parse(text) : [];
    const candidates = (Array.isArray(releases) ? releases : [])
      .filter((release) => !release?.draft && !release?.prerelease)
      .map((release) => ({ release, version: extractWindowsReleaseVersion(release) }))
      .filter((item) => item.version)
      .sort((left, right) => compareAppVersions(right.version, left.version));
    const latest = candidates[0] || null;

    if (!latest) {
      return {
        ok: true,
        currentVersion,
        currentChannel: "Windows stable",
        hasUpdate: false,
        message: "No Windows stable release was found.",
        releasesUrl: RELEASES_PAGE_URL,
      };
    }

    const latestVersion = latest.version.raw;
    const asset = chooseWindowsInstallerAsset(latest.release, latestVersion);
    const sha256Asset = asset ? chooseWindowsSha256Asset(latest.release, asset) : null;
    const hasUpdate = currentParsed
      ? compareAppVersions(latest.version, currentParsed) > 0
      : latestVersion !== currentVersion;

    return {
      ok: true,
      currentVersion,
      currentChannel: "Windows stable",
      latestVersion,
      latestTitle: latest.release.name,
      latestTag: latest.release.tag_name,
      latestUrl: latest.release.html_url,
      latestNotes: String(latest.release.body || "").slice(0, 4000),
      publishedAt: latest.release.published_at,
      hasUpdate,
      installerAsset: asset
        ? {
            name: asset.name,
            size: asset.size,
            downloadUrl: asset.browser_download_url,
          }
        : null,
      sha256Asset: sha256Asset
        ? {
            name: sha256Asset.name,
            size: sha256Asset.size,
            downloadUrl: sha256Asset.browser_download_url,
          }
        : null,
      releasesUrl: RELEASES_PAGE_URL,
      message: hasUpdate ? `Found ${latest.release.name}.` : "Already on the latest Windows stable version.",
    };
  } catch (error) {
    return {
      ok: false,
      currentVersion,
      currentChannel: "Windows stable",
      hasUpdate: false,
      message: error?.name === "AbortError" ? "Update check timed out." : error.message,
      releasesUrl: RELEASES_PAGE_URL,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function checkForUpdatesWithState() {
  resetUpdateProgress({ status: "checking", update: null, message: "正在检查更新..." });
  const result = await checkForUpdates();
  setUpdateState({
    status: result.ok && result.hasUpdate ? "available" : result.ok ? "idle" : "error",
    update: result.ok && result.hasUpdate ? result : null,
    totalBytes: result.installerAsset?.size || 0,
    message: result.message,
  });
  return result;
}

async function loadPendingUpdateState() {
  if (isMac) {
    return publicUpdateState();
  }
  if (["checking", "downloading", "verifying", "installing"].includes(updateState.status)) {
    return publicUpdateState();
  }
  if (updateState.status === "ready_to_install" && updateState.filePath && existsSync(updateState.filePath)) {
    return publicUpdateState();
  }

  const pending = await readJson(pendingUpdatePath, null);
  if (!pending?.filePath) {
    return publicUpdateState();
  }

  let installerPath;
  try {
    installerPath = assertUpdateCacheFile(pending.filePath);
  } catch (error) {
    await fs.rm(pendingUpdatePath, { force: true });
    return resetUpdateProgress({ status: "error", update: null, message: error.message });
  }
  if (!existsSync(installerPath)) {
    await fs.rm(pendingUpdatePath, { force: true });
    return resetUpdateProgress({ status: "idle", update: null, message: "" });
  }

  if (pending.version && compareAppVersions(pending.version, app.getVersion()) <= 0) {
    await fs.rm(pendingUpdatePath, { force: true });
    return resetUpdateProgress({ status: "idle", update: null, message: "当前已是已下载更新版本。" });
  }

  return setUpdateState({
    status: "ready_to_install",
    update: pending.update || null,
    downloadedBytes: pending.size || 0,
    totalBytes: pending.size || 0,
    percent: 100,
    filePath: installerPath,
    message: "更新已下载并通过校验。",
  });
}

async function downloadUpdate() {
  if (isMac) {
    return resetUpdateProgress({ status: "idle", update: null, message: "macOS 版本暂不提供自动更新。" });
  }
  if (updateState.status === "downloading") {
    return publicUpdateState();
  }

  let update = updateState.update;
  if (!update?.hasUpdate) {
    const checked = await checkForUpdatesWithState();
    if (!checked?.hasUpdate) {
      return publicUpdateState();
    }
    update = checked;
  }

  if (!update.installerAsset?.downloadUrl || !update.installerAsset?.name) {
    throw new Error("Release 中没有可下载的 Windows 安装包。");
  }
  if (!update.sha256Asset?.downloadUrl) {
    throw new Error("Release 缺少 SHA256 校验文件，不能执行应用内安装。");
  }

  await fs.mkdir(updateDir, { recursive: true });
  const fileName = sanitizeFileName(update.installerAsset.name);
  const finalPath = path.join(updateDir, fileName);
  const tempPath = `${finalPath}.download`;
  const metaPath = `${finalPath}.meta.json`;
  const totalBytes = Number(update.installerAsset.size || 0);
  updateDownloadController = new AbortController();

  try {
    await fs.rm(tempPath, { force: true });
    resetUpdateProgress({
      status: "downloading",
      update,
      totalBytes,
      filePath: finalPath,
      message: "正在下载安装包...",
    });
    const response = await net.fetch(update.installerAsset.downloadUrl, {
      headers: { "User-Agent": "BXB-Homework" },
      signal: updateDownloadController.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`安装包下载失败 HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const downloadedBytes = await writeResponseBodyToFile(response, tempPath, totalBytes);
    if (totalBytes && downloadedBytes !== totalBytes) {
      throw new Error(`安装包大小不匹配：已下载 ${downloadedBytes} 字节，预期 ${totalBytes} 字节。`);
    }

    setUpdateState({ status: "verifying", message: "正在校验安装包..." });
    const [expectedSha256, actualSha256] = await Promise.all([
      readSha256Asset(update.sha256Asset.downloadUrl),
      sha256File(tempPath),
    ]);
    if (actualSha256 !== expectedSha256) {
      throw new Error("安装包 SHA256 校验失败。");
    }

    await fs.rm(finalPath, { force: true });
    await fs.rename(tempPath, finalPath);
    const pendingUpdate = {
      version: update.latestVersion,
      releaseTitle: update.latestTitle,
      releaseTag: update.latestTag,
      update,
      assetName: update.installerAsset.name,
      size: totalBytes || downloadedBytes,
      sha256: actualSha256,
      downloadedAt: new Date().toISOString(),
      filePath: finalPath,
    };
    await writeJson(metaPath, pendingUpdate);
    await writeJson(pendingUpdatePath, pendingUpdate);

    return setUpdateState({
      status: "ready_to_install",
      downloadedBytes: downloadedBytes,
      totalBytes: totalBytes || downloadedBytes,
      percent: 100,
      filePath: finalPath,
      message: "更新已下载并通过校验。",
    });
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    return setUpdateState({
      status: "error",
      message: error?.name === "AbortError" ? "下载已取消。" : error.message,
    });
  } finally {
    updateDownloadController = null;
  }
}

async function cancelUpdateDownload() {
  if (isMac) {
    return publicUpdateState();
  }
  if (updateDownloadController) {
    updateDownloadController.abort();
  }
  return setUpdateState({ status: "idle", message: "下载已取消。" });
}

async function installUpdate() {
  if (isMac) {
    throw new Error("macOS 版本暂不提供自动更新。");
  }
  if (updateState.status !== "ready_to_install" || !updateState.filePath) {
    throw new Error("没有已下载并通过校验的更新安装包。");
  }
  const installerPath = assertUpdateCacheFile(updateState.filePath);
  if (!existsSync(installerPath)) {
    throw new Error("更新安装包不存在，请重新下载。");
  }

  setUpdateState({ status: "installing", message: "正在启动安装器，应用即将退出..." });
  const child = spawn(installerPath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  setTimeout(() => app.quit(), 500);
  return publicUpdateState();
}

async function openExternalHttpUrl(url) {
  const target = String(url || RELEASES_PAGE_URL).trim() || RELEASES_PAGE_URL;
  const parsed = new URL(target);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("Only http(s) update links can be opened.");
  }
  await shell.openExternal(parsed.toString());
  return { ok: true, url: parsed.toString() };
}

function createWindow() {
  app.applicationMenu = null;
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: "BXB Homework",
    backgroundColor: "#f3f3f3",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.setAutoHideMenuBar(true);

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("app:info", async () => ({
  isPackaged: app.isPackaged,
  version: app.getVersion(),
  platform: process.platform,
  updateChannel: isMac ? "macOS preview" : "Windows stable",
  userDataRoot,
  dataRoot,
  workspaceDir,
  draftDir,
  updateDir,
  modelConfigPath,
  conversationsPath,
  payloadRoot,
  browserDependency: getBrowserDependencyStatus(),
}));

ipcMain.handle("feature:get", async () => loadFeatureConfig(featureConfigPath));
ipcMain.handle("feature:save", async (_event, patch) => saveFeatureConfig(featureConfigPath, patch));
ipcMain.handle("alerts:summary", async () => getAlertSummary());
ipcMain.handle("alerts:refresh", async () => {
  await runAlertChecks();
  return getAlertSummary();
});
ipcMain.handle("knowledge:refresh", async () => refreshKnowledge());
ipcMain.handle("knowledge:list", async () => listReviewNotes());
ipcMain.handle("knowledge:read", async (_event, { file } = {}) => readReviewNote(file));
ipcMain.handle("knowledge:summarize", async () => summarizeReviewWithModel());
ipcMain.handle("auto:modes:get", async () => ({
  modes: await loadCourseModes(courseModesPath),
  labels: MODE_LABELS,
}));
ipcMain.handle("auto:modes:set", async (_event, { courseId, mode }) => ({
  ok: true,
  modes: await saveCourseMode(courseModesPath, courseId, mode),
}));
ipcMain.handle("auto:run", async () => runAutoCompleteOnce());
ipcMain.handle("app:open-path", async (_event, { key } = {}) => openAppPath(key));
ipcMain.handle("bxb:session", async () => callTool("session_status"));
ipcMain.handle("bxb:tool", async (_event, { name, args }) => callTool(name, args));
ipcMain.handle("workspace:import", async () => importWorkspaceFiles());
ipcMain.handle("workspace:save-pastes", async (_event, { items } = {}) => saveWorkspacePastes(items));
ipcMain.handle("workspace:open", async () => {
  await fs.mkdir(workspaceDir, { recursive: true });
  await shell.openPath(workspaceDir);
  return { ok: true, workspaceDir };
});
ipcMain.handle("workspace:image-data-url", async (_event, { filePath } = {}) => getWorkspaceImageDataUrl(filePath));
ipcMain.handle("update:check", async () => checkForUpdatesWithState());
ipcMain.handle("update:download", async () => downloadUpdate());
ipcMain.handle("update:install", async () => installUpdate());
ipcMain.handle("update:cancel", async () => cancelUpdateDownload());
ipcMain.handle("update:status", async () => loadPendingUpdateState());
ipcMain.handle("update:open-url", async (_event, { url } = {}) => openExternalHttpUrl(url));
ipcMain.handle("config:model:load", async () => loadModelConfig());
ipcMain.handle("config:model:save", async (_event, config) => saveModelConfig(config));
ipcMain.handle("config:model:clear", async () => {
  await fs.rm(modelConfigPath, { force: true });
  return loadModelConfig();
});
ipcMain.handle("config:model:list", async (_event, config) => listModelOptions(config));
ipcMain.handle("config:model:test", async (_event, config) => testModelConfig(config));
ipcMain.handle("agent:chat", async (_event, payload) => runAgent(payload));
ipcMain.handle("agent:compact", async (_event, payload = {}) => compactAgentContext(payload.conversationId));
ipcMain.handle("agent:conversations:list", async () => listConversations());
ipcMain.handle("agent:conversations:create", async (_event, payload = {}) => createConversation(payload.title));
ipcMain.handle("agent:conversations:select", async (_event, payload = {}) => selectConversation(payload.conversationId));
ipcMain.handle("agent:conversations:rename", async (_event, payload = {}) =>
  renameConversation(payload.conversationId, payload.title),
);
ipcMain.handle("agent:conversations:delete", async (_event, payload = {}) => deleteConversation(payload.conversationId));
ipcMain.handle("agent:reset", async () => {
  const { state, conversation } = await getActiveConversation();
  conversation.messages = [];
  conversation.turns = [];
  conversation.updatedAt = nowIso();
  await saveConversationState(state);
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  scheduleAlertChecks();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
