import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { BanxuebangClient } from "../src/banxuebang-client.js";
import { SessionStore } from "../src/session-store.js";
import { createToolDefinitions, executeTool } from "../src/tool-definitions.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const isPackaged = process.env.BXB_WINUI_PACKAGED === "1";
const electronUserDataRoot = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "bxb-homework-electron");
const dataRoot = path.join(electronUserDataRoot, ".banxuebang");
const workspaceDir = path.join(dataRoot, "workspace");
const draftDir = path.join(dataRoot, "drafts");
const updateDir = path.join(electronUserDataRoot, "updates");
const pendingUpdatePath = path.join(updateDir, "pending-update.json");
const modelConfigPath = path.join(electronUserDataRoot, "model-config.json");
const conversationsPath = path.join(electronUserDataRoot, "agent-conversations.json");
const sessionFile = path.join(dataRoot, "session.json");
const RELEASES_API_URL = "https://api.github.com/repos/GRAY-XY/BXB_tools/releases?per_page=30";
const RELEASES_PAGE_URL = "https://github.com/GRAY-XY/BXB_tools/releases";
const WINDOWS_RELEASE_TITLE_PREFIX = "BXB Homework v";
const LEGACY_WINDOWS_PREVIEW_TITLE_PREFIX = "BXB Homework Win v";
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PASTED_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".avif", "image/avif"],
]);
const PASTED_IMAGE_EXTENSION_BY_MIME = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
  ["image/avif", ".avif"],
]);
const DEFAULT_SYSTEM_PROMPT =
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交、私信或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。如果作业已过期且可能无法补交，可以在草稿提示字段中建议用户私信老师，但只能保存草稿等待用户审核。给出或保存草稿正文时，draft_text 必须是纯文本正文，不要使用 Markdown 标题、列表、表格、代码块、加粗、引用或其他 Markdown 格式；如果需要给用户说明保存状态，可以在助手回复里用 Markdown，但草稿正文内容本身必须保持纯文本。";

const client = new BanxuebangClient(new SessionStore(sessionFile));
const toolDefinitions = createToolDefinitions(client);
let conversationStatePromise = null;
let updateState = {
  status: "idle",
  update: null,
  downloadedBytes: 0,
  totalBytes: 0,
  percent: 0,
  filePath: null,
  message: "",
};
const updateProxyAgents = new Map();

process.env.BANXUEBANG_SESSION_FILE = sessionFile;
process.env.BANXUEBANG_DRAFT_DIR = draftDir;
process.env.BANXUEBANG_WORKSPACE_DIR = workspaceDir;

function writeResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function updateProxyCandidates() {
  const explicitProxy = String(process.env.BXB_UPDATE_PROXY || "").trim();
  if (/^(direct|none|off)$/i.test(explicitProxy)) {
    return [null];
  }

  const configured = [
    explicitProxy,
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    ...readWindowsSystemProxyUrls(),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return [...new Set(configured), null];
}

function readWindowsSystemProxyUrls() {
  if (process.platform !== "win32") {
    return [];
  }

  try {
    const proxyEnable = queryWindowsInternetSetting("ProxyEnable");
    if (!/\b0x1\b|\b1\b/.test(proxyEnable)) {
      return [];
    }

    const proxyServer = queryWindowsInternetSetting("ProxyServer");
    return parseWindowsProxyServer(proxyServer);
  } catch {
    return [];
  }
}

function queryWindowsInternetSetting(name) {
  const result = spawnSync(
    "reg.exe",
    ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", name],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) return "";
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function parseWindowsProxyServer(value) {
  const match = String(value || "").match(/ProxyServer\s+REG_\w+\s+(.+)/i);
  const raw = (match?.[1] || "").trim();
  if (!raw) return [];

  const entries = raw.split(";").map((entry) => entry.trim()).filter(Boolean);
  const keyed = new Map();
  const plain = [];
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator > 0) {
      keyed.set(entry.slice(0, separator).toLowerCase(), entry.slice(separator + 1));
    } else {
      plain.push(entry);
    }
  }

  return [
    keyed.get("https"),
    keyed.get("http"),
    keyed.get("all"),
    ...plain,
  ]
    .map(normalizeHttpProxyUrl)
    .filter(Boolean);
}

function normalizeHttpProxyUrl(value) {
  const text = String(value || "").trim();
  if (!text || /^socks/i.test(text)) return "";
  if (/^https?:\/\//i.test(text)) return text;
  return `http://${text}`;
}

function updateProxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (!updateProxyAgents.has(proxyUrl)) {
    updateProxyAgents.set(proxyUrl, new ProxyAgent(proxyUrl));
  }
  return updateProxyAgents.get(proxyUrl);
}

async function fetchUpdateUrl(url, options = {}) {
  const candidates = updateProxyCandidates();
  const failures = [];
  for (const proxyUrl of candidates) {
    try {
      const init = { ...options };
      const dispatcher = updateProxyAgent(proxyUrl);
      if (dispatcher) init.dispatcher = dispatcher;
      return await undiciFetch(url, init);
    } catch (error) {
      failures.push(`${proxyUrl || "direct"}: ${error?.message || error}`);
    }
  }

  const detail = failures.length ? `；已尝试 ${failures.join("；")}` : "";
  throw new Error(`无法连接 GitHub 更新服务${detail}`);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

function nowIso() {
  return new Date().toISOString();
}

function safeId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function maskKey(value) {
  const text = String(value || "");
  if (!text) return "";
  if (text.length <= 8) return `${text.slice(0, 2)}****`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function browserCacheCandidates() {
  return [
    path.join(electronUserDataRoot, "ms-playwright"),
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "ms-playwright"),
    path.join(os.homedir(), "AppData", "Local", "ms-playwright"),
  ];
}

async function hasChromiumCache(root) {
  if (!root || !existsSync(root)) return false;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("chromium"));
  } catch {
    return false;
  }
}

async function findExistingBrowserRoot() {
  for (const candidate of browserCacheCandidates()) {
    if (await hasChromiumCache(candidate)) return candidate;
  }
  return null;
}

async function getBrowserDependencyStatus() {
  const existingRoot = await findExistingBrowserRoot();
  return {
    ready: Boolean(existingRoot),
    browserRoot: existingRoot || path.join(electronUserDataRoot, "ms-playwright"),
    candidates: browserCacheCandidates(),
    source: existingRoot ? "existing-cache" : "missing",
  };
}

async function ensurePlaywrightBrowsers() {
  const existingRoot = await findExistingBrowserRoot();
  if (existingRoot) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = existingRoot;
    return getBrowserDependencyStatus();
  }

  const browserRoot = path.join(electronUserDataRoot, "ms-playwright");
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
  const zipCandidates = [
    path.join(repoRoot, "runtime", "ms-playwright-browsers.zip"),
    path.join(repoRoot, "payload", "runtime", "ms-playwright-browsers.zip"),
    path.join(repoRoot, "build_assets", "ms-playwright-browsers.zip"),
  ];
  const zipPath = zipCandidates.find((candidate) => existsSync(candidate));
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
  return getBrowserDependencyStatus();
}

function deriveChatUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/models")) return `${normalized.slice(0, -"/models".length)}/chat/completions`;
  return `${normalized}/chat/completions`;
}

function deriveModelsUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (normalized.endsWith("/models")) return normalized;
  if (normalized.endsWith("/chat/completions")) return `${normalized.slice(0, -"/chat/completions".length)}/models`;
  return `${normalized}/models`;
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
    .map((item) => (typeof item === "string" ? item : String(item?.id || item?.name || item?.model || "").trim()))
    .filter(Boolean);
}

function modelRequiresTemperatureOne(config) {
  const baseUrl = String(config?.baseUrl || "").toLowerCase();
  const modelName = String(config?.modelName || "").toLowerCase();
  return baseUrl.includes("moonshot.cn") || modelName.startsWith("kimi-");
}

function normalizeTemperature(value, fallback) {
  const temperature = Number.parseFloat(value);
  if (!Number.isFinite(temperature)) return fallback;
  return Math.min(2, Math.max(0, temperature));
}

function normalizeLongPasteThreshold(value, fallback = 4000) {
  const threshold = Number.parseInt(value, 10);
  if (!Number.isFinite(threshold)) return fallback;
  return Math.min(100000, Math.max(500, threshold));
}

function normalizeTheme(value) {
  return String(value || "").trim().toLowerCase() === "dark" ? "dark" : "light";
}

function chatTemperature(config, fallback) {
  return modelRequiresTemperatureOne(config) ? 1 : fallback;
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
    theme: "light",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });
  return {
    ...config,
    chatTemperature: normalizeTemperature(config.chatTemperature, 0.2),
    compactTemperature: normalizeTemperature(config.compactTemperature, 0.1),
    longPasteThreshold: normalizeLongPasteThreshold(config.longPasteThreshold, 4000),
    theme: normalizeTheme(config.theme),
    systemPrompt: String(config.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT,
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    apiKeyMasked: maskKey(config.apiKey),
    configPath: modelConfigPath,
  };
}

function publicModelConfig(config) {
  const { apiKey, ...rest } = config;
  return {
    ...rest,
    apiKey: "",
    hasApiKey: Boolean(apiKey),
    apiKeyMasked: maskKey(apiKey),
  };
}

async function saveModelConfig(config) {
  const existing = await readJson(modelConfigPath, {});
  const normalized = {
    apiKey: config?.apiKey === undefined ? String(existing.apiKey || "").trim() : String(config.apiKey || "").trim(),
    baseUrl: config?.baseUrl === undefined ? String(existing.baseUrl || "").trim() : String(config.baseUrl || "").trim(),
    modelName: config?.modelName === undefined ? String(existing.modelName || "").trim() : String(config.modelName || "").trim(),
    contextLength: Number.parseInt(config?.contextLength ?? existing.contextLength ?? 0, 10) || 0,
    chatTemperature: normalizeTemperature(config?.chatTemperature ?? existing.chatTemperature, 0.2),
    compactTemperature: normalizeTemperature(config?.compactTemperature ?? existing.compactTemperature, 0.1),
    longPasteThreshold: normalizeLongPasteThreshold(config?.longPasteThreshold ?? existing.longPasteThreshold, 4000),
    maxToolRounds: Math.max(1, Number.parseInt(config?.maxToolRounds ?? existing.maxToolRounds ?? 6, 10) || 6),
    theme: normalizeTheme(config?.theme ?? existing.theme),
    systemPrompt: String(config?.systemPrompt ?? existing.systemPrompt ?? "").trim() || DEFAULT_SYSTEM_PROMPT,
  };
  await writeJson(modelConfigPath, normalized);
  return loadModelConfig();
}

async function listModelOptions(config) {
  const saved = await loadModelConfig();
  const candidate = {
    apiKey: config?.apiKey === undefined ? String(saved.apiKey || "").trim() : String(config.apiKey || "").trim(),
    baseUrl: config?.baseUrl === undefined ? String(saved.baseUrl || "").trim() : String(config.baseUrl || "").trim(),
  };
  if (!candidate.baseUrl) throw new Error("请先填写调用链接。");
  const headers = { Accept: "application/json" };
  if (candidate.apiKey) headers.Authorization = `Bearer ${candidate.apiKey}`;
  const response = await fetch(deriveModelsUrl(candidate.baseUrl), { headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}: ${text.slice(0, 800)}`);
  const modelIds = extractModelIds(text ? JSON.parse(text) : {});
  return {
    modelsUrl: deriveModelsUrl(candidate.baseUrl),
    modelsCount: modelIds.length,
    modelIds,
    sampleModels: modelIds.slice(0, 20),
    message: modelIds.length ? `已读取 ${modelIds.length} 个模型。` : "连接成功，但没有读取到模型名称。",
  };
}

async function testModelConfig(config) {
  const candidate = await saveModelConfig(config);
  if (!candidate.apiKey || !candidate.baseUrl || !candidate.modelName) {
    throw new Error("请先填写 API Key、调用链接和模型名称。");
  }
  const listed = await listModelOptions(candidate);
  return {
    ok: listed.modelIds.includes(candidate.modelName),
    modelsUrl: listed.modelsUrl,
    modelName: candidate.modelName,
    modelsCount: listed.modelIds.length,
    sampleModels: listed.modelIds.slice(0, 20),
    message: listed.modelIds.includes(candidate.modelName)
      ? `连接成功，已找到模型 ${candidate.modelName}。`
      : `连接成功，但模型列表里没有找到 ${candidate.modelName}。`,
  };
}

function newConversation(title = "新对话") {
  const timestamp = nowIso();
  return { id: safeId(), title, createdAt: timestamp, updatedAt: timestamp, messages: [], turns: [] };
}

function normalizeConversation(raw) {
  const fallback = newConversation();
  return {
    id: String(raw?.id || fallback.id),
    title: String(raw?.title || "新对话"),
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
  return conversation ? { ...conversationSummary(conversation), messages: conversation.messages } : null;
}

async function loadConversationState() {
  if (conversationStatePromise) return conversationStatePromise;
  conversationStatePromise = (async () => {
    const stored = await readJson(conversationsPath, null);
    const conversations = Array.isArray(stored?.conversations)
      ? stored.conversations.map(normalizeConversation)
      : [];
    if (!conversations.length) conversations.push(newConversation());
    const activeId = conversations.some((item) => item.id === stored?.activeId) ? stored.activeId : conversations[0].id;
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
  if (!conversation) throw new Error("找不到指定对话。");
  state.activeId = conversation.id;
  await saveConversationState(state);
  return listConversations();
}

async function renameConversation(conversationId, title) {
  const state = await loadConversationState();
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new Error("找不到指定对话。");
  conversation.title = String(title || "").trim() || "未命名对话";
  conversation.updatedAt = nowIso();
  await saveConversationState(state);
  return listConversations();
}

async function deleteConversation(conversationId) {
  const state = await loadConversationState();
  state.conversations = state.conversations.filter((item) => item.id !== conversationId);
  if (!state.conversations.length) state.conversations.push(newConversation());
  if (!state.conversations.some((item) => item.id === state.activeId)) state.activeId = state.conversations[0].id;
  await saveConversationState(state);
  return listConversations();
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
  return executeTool(toolDefinitions, name, args || {});
}

function safeToolSchemas() {
  const tools = [
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
          subject_name: { type: "string", description: "课程名称；传“全部课程”表示所有课程。" },
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
      description: "读取当前课程成绩概览。",
      parameters: { type: "object", properties: { transfer_class_id: { type: "string" } } },
    },
    {
      name: "download_task_attachment",
      description: "下载任务附件到本地，通常用于后续读取 PDF/DOCX/文本附件。",
      parameters: {
        type: "object",
        properties: { task_id: { type: "string" }, file_id: { type: "string" }, directory: { type: "string" } },
        required: ["file_id"],
      },
    },
    {
      name: "read_task_attachment",
      description: "下载并读取任务附件文本，支持 txt/html/pdf/docx 等可解析格式。",
      parameters: {
        type: "object",
        properties: { task_id: { type: "string" }, file_id: { type: "string" }, max_chars: { type: "number" }, directory: { type: "string" } },
        required: ["file_id"],
      },
    },
    {
      name: "list_workspace_files",
      description: "列出本地工作区文件。",
      parameters: { type: "object", properties: { query: { type: "string" }, max_files: { type: "number" } } },
    },
    {
      name: "read_workspace_file",
      description: "读取工作区文件内容，可按相对路径或文件名查找。",
      parameters: { type: "object", properties: { file: { type: "string" }, max_chars: { type: "number" } }, required: ["file"] },
    },
    {
      name: "rename_workspace_file",
      description: "重命名工作区文件。new_name 如果没有扩展名，会保留原文件扩展名。",
      parameters: { type: "object", properties: { file: { type: "string" }, new_name: { type: "string" } }, required: ["file", "new_name"] },
    },
    {
      name: "write_workspace_text_file",
      description: "在工作区创建文本文件。只保存到本机，不会上传。",
      parameters: { type: "object", properties: { file_name: { type: "string" }, content: { type: "string" }, overwrite: { type: "boolean" } }, required: ["file_name", "content"] },
    },
    {
      name: "extract_pdf_text",
      description: "从本地 PDF 文件提取文本。",
      parameters: { type: "object", properties: { local_path: { type: "string" }, max_chars: { type: "number" } }, required: ["local_path"] },
    },
    {
      name: "extract_docx_text",
      description: "从本地 DOCX 文件提取文本。",
      parameters: { type: "object", properties: { local_path: { type: "string" }, max_chars: { type: "number" } }, required: ["local_path"] },
    },
    {
      name: "run_python_snippet",
      description: "短时运行 Python 小程序做辅助计算或小规模数据处理。",
      parameters: { type: "object", properties: { code: { type: "string" }, stdin: { type: "string" }, timeout_ms: { type: "number" } }, required: ["code"] },
    },
    {
      name: "web_search",
      description: "通过本机浏览器联网搜索。适合查询最新资料；回答时应引用返回结果中的链接。",
      parameters: { type: "object", properties: { query: { type: "string" }, max_results: { type: "number" }, engine: { type: "string", enum: ["bing"] }, timeout_ms: { type: "number" } }, required: ["query"] },
    },
    {
      name: "read_web_page",
      description: "通过本机浏览器读取 http(s) 网页正文。",
      parameters: { type: "object", properties: { url: { type: "string" }, max_chars: { type: "number" }, timeout_ms: { type: "number" } }, required: ["url"] },
    },
    {
      name: "collect_task_submission_context",
      description: "收集写作业草稿需要的任务正文、附件内容和缺失信息。",
      parameters: { type: "object", properties: { task_id: { type: "string" }, max_chars: { type: "number" }, max_attachments: { type: "number" } }, required: ["task_id"] },
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
      parameters: { type: "object", properties: { status: { type: "string", enum: ["pending_review", "approved", "rejected", "submitted", "sent_to_teacher", "all"] } } },
    },
    {
      name: "get_submission_draft",
      description: "读取一个待审核草稿。",
      parameters: { type: "object", properties: { draft_id: { type: "string" } }, required: ["draft_id"] },
    },
  ];
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

async function runAgent({ text, conversationId } = {}) {
  const config = await loadModelConfig();
  const prompt = String(text || "").trim();
  if (!prompt) throw new Error("消息不能为空。");
  if (!config.apiKey || !config.baseUrl || !config.modelName) {
    return { message: "还没有配置大模型。请先到“设置”填写 API Key、调用链接和模型名称。", steps: [], usage: null };
  }

  const { state, conversation } = await getActiveConversation(conversationId);
  const steps = [];
  const pushStep = (kind, title, detail = "") => steps.push({ kind, title, detail, at: nowIso() });
  const messages = [
    { role: "system", content: String(config.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT },
    ...conversation.turns,
    { role: "user", content: prompt },
  ];
  const maxToolRounds = Math.max(1, Number.parseInt(config.maxToolRounds || 6, 10));
  let usage = null;

  for (let index = 0; index < maxToolRounds; index += 1) {
    pushStep("llm", `第 ${index + 1} 轮请求模型`);
    const response = await fetch(deriveChatUrl(config.baseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.modelName,
        messages,
        tools: safeToolSchemas(),
        tool_choice: "auto",
        temperature: chatTemperature(config, normalizeTemperature(config.chatTemperature, 0.2)),
      }),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}: ${raw.slice(0, 1200)}`);
    const payload = raw ? JSON.parse(raw) : {};
    usage = payload.usage || usage;
    const message = payload?.choices?.[0]?.message || {};
    const toolCalls = message.tool_calls || [];

    if (!toolCalls.length) {
      const content = typeof message.content === "string" ? message.content : "执行完成。";
      const timestamp = nowIso();
      conversation.turns.push({ role: "user", content: prompt }, { role: "assistant", content });
      conversation.messages.push({ role: "user", text: prompt, at: timestamp }, { role: "assistant", text: content, at: nowIso() });
      if (conversation.title === "新对话") conversation.title = prompt.slice(0, 28) || "新对话";
      conversation.updatedAt = nowIso();
      state.activeId = conversation.id;
      await saveConversationState(state);
      pushStep("done", "模型已生成最终回答");
      return { message: content, steps, usage, conversation: conversationSummary(conversation) };
    }

    messages.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });
    for (const call of toolCalls) {
      const toolName = call?.function?.name;
      const args = JSON.parse(call?.function?.arguments || "{}");
      pushStep("tool", `调用工具 ${toolName}`, JSON.stringify(args, null, 2));
      const result = await callTool(toolName, args);
      pushStep("tool", `工具 ${toolName} 已完成`, JSON.stringify(result, null, 2).slice(0, 4000));
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error(`模型连续请求工具超过 ${maxToolRounds} 轮，仍未给出最终回答。`);
}

async function compactAgentContext(conversationId) {
  const config = await loadModelConfig();
  if (!config.apiKey || !config.baseUrl || !config.modelName) throw new Error("还没有配置大模型，无法压缩上下文。");
  const { state, conversation } = await getActiveConversation(conversationId);
  if (!conversation.turns.length) return { ok: true, summary: "当前没有需要压缩的历史对话。", keptTurns: 0, previousTurns: 0, usage: null };
  const previousTurns = conversation.turns.length;
  const recentTurns = conversation.turns.slice(-6);
  const olderTurns = conversation.turns.slice(0, -6);
  const response = await fetch(deriveChatUrl(config.baseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.modelName,
      messages: [
        {
          role: "system",
          content: "你负责压缩伴学邦桌面助手的对话上下文。请用中文输出结构化摘要，保留用户目标、已确认事实、当前课程/任务/草稿ID、工具调用结论、待办、缺失信息和安全约束。不要编造，不要包含 API Key、登录令牌、密码或完整本地敏感路径。",
        },
        { role: "user", content: JSON.stringify({ olderConversation: olderTurns, recentConversation: recentTurns }, null, 2) },
      ],
      temperature: chatTemperature(config, normalizeTemperature(config.compactTemperature, 0.1)),
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const payload = raw ? JSON.parse(raw) : {};
  const summary = String(payload?.choices?.[0]?.message?.content || "").trim() || "历史对话已压缩。";
  conversation.turns = [{ role: "system", content: `此前对话压缩摘要：\n${summary}` }, ...recentTurns];
  conversation.messages = [{ role: "assistant", text: ["已压缩上下文，保留近期对话和关键任务信息。", "", summary].join("\n"), at: nowIso() }];
  conversation.updatedAt = nowIso();
  state.activeId = conversation.id;
  await saveConversationState(state);
  return { ok: true, summary, keptTurns: conversation.turns.length, previousTurns, usage: payload.usage || null, conversation: conversationSummary(conversation) };
}

function sanitizeWorkspaceName(value) {
  const baseName = path.basename(String(value || "file"));
  return baseName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "file";
}

async function nextWorkspacePath(fileName) {
  await fs.mkdir(workspaceDir, { recursive: true });
  const parsed = path.parse(sanitizeWorkspaceName(fileName));
  let candidate = path.join(workspaceDir, `${parsed.name}${parsed.ext}`);
  let index = 2;
  while (existsSync(candidate)) {
    candidate = path.join(workspaceDir, `${parsed.name} (${index})${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

async function importWorkspacePaths(paths) {
  const sourcePaths = Array.isArray(paths) ? paths : [];
  const imported = [];
  for (const sourcePath of sourcePaths) {
    const targetPath = await nextWorkspacePath(sourcePath);
    await fs.copyFile(sourcePath, targetPath);
    imported.push({
      name: path.basename(targetPath),
      path: targetPath,
      relativePath: path.relative(workspaceDir, targetPath).replaceAll("\\", "/"),
      sourcePath,
    });
  }
  return { imported, canceled: false };
}

async function saveWorkspacePastes(items) {
  const entries = Array.isArray(items) ? items.slice(0, 20) : [];
  const saved = [];
  for (const entry of entries) {
    const kind = String(entry?.kind || "");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    let fileName;
    let buffer;
    if (kind === "image") {
      const mimeType = String(entry?.mimeType || "").toLowerCase();
      const extension = PASTED_IMAGE_EXTENSION_BY_MIME.get(mimeType);
      if (!extension) throw new Error(`不支持粘贴的图片类型：${mimeType || "未知类型"}`);
      buffer = Buffer.from(entry?.bytes || []);
      if (!buffer.length || buffer.byteLength > MAX_PASTED_FILE_BYTES) throw new Error("粘贴图片为空或超过 25 MB。");
      const requestedName = sanitizeWorkspaceName(entry?.name || `pasted-image-${timestamp}${extension}`);
      fileName = `${path.parse(requestedName).name || `pasted-image-${timestamp}`}${extension}`;
    } else if (kind === "text") {
      const text = String(entry?.text || "");
      if (!text) throw new Error("粘贴文本为空。");
      buffer = Buffer.from(text, "utf8");
      if (buffer.byteLength > MAX_PASTED_FILE_BYTES) throw new Error("粘贴文本超过 25 MB。");
      const requestedName = sanitizeWorkspaceName(entry?.name || `pasted-text-${timestamp}.txt`);
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
    throw new Error("Only workspace files can be previewed.");
  }
  return resolved;
}

async function getWorkspaceImageDataUrl(filePath) {
  const resolved = assertWorkspacePath(filePath);
  const extension = path.extname(resolved).toLowerCase();
  const mimeType = IMAGE_MIME_BY_EXTENSION.get(extension);
  if (!mimeType) throw new Error("This file type is not supported for image preview.");
  const fileStat = await fs.stat(resolved);
  if (!fileStat.isFile()) throw new Error("Image preview target is not a file.");
  if (fileStat.size > MAX_INLINE_IMAGE_BYTES) throw new Error("Image is too large to preview inline.");
  const buffer = await fs.readFile(resolved);
  return { fileName: path.basename(resolved), path: resolved, mimeType, sizeBytes: buffer.byteLength, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}` };
}

function parseAppVersion(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-pre(?:\.(\d+))?)?$/);
  if (!match) return null;
  return { raw: text, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), preview: text.includes("-pre"), preNumber: match[4] ? Number(match[4]) : 0 };
}

function compareAppVersions(left, right) {
  const a = typeof left === "string" ? parseAppVersion(left) : left;
  const b = typeof right === "string" ? parseAppVersion(right) : right;
  if (!a || !b) return 0;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.preview !== b.preview) return a.preview ? -1 : 1;
  if (a.preNumber !== b.preNumber) return a.preNumber > b.preNumber ? 1 : -1;
  return 0;
}

function extractWindowsReleaseVersion(release) {
  const title = String(release?.name || "").trim();
  const version = title.startsWith(WINDOWS_RELEASE_TITLE_PREFIX)
    ? title.slice(WINDOWS_RELEASE_TITLE_PREFIX.length).trim()
    : title.startsWith(LEGACY_WINDOWS_PREVIEW_TITLE_PREFIX)
      ? title.slice(LEGACY_WINDOWS_PREVIEW_TITLE_PREFIX.length).trim()
      : null;
  return version ? parseAppVersion(version) : null;
}

function chooseAsset(release, suffix, version) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  return assets.find((asset) => String(asset?.name || "").toLowerCase().endsWith(suffix) && (!version || String(asset.name).toLowerCase().includes(String(version).toLowerCase()))) || null;
}

async function readPackageVersion() {
  try {
    return JSON.parse(await fs.readFile(path.join(repoRoot, "desktop", "package.json"), "utf8")).version || "0.0.0";
  } catch {
    try {
      return JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8")).version || "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
}

async function checkForUpdates() {
  const currentVersion = await readPackageVersion();
  const currentParsed = parseAppVersion(currentVersion);
  const response = await fetchUpdateUrl(RELEASES_API_URL, { headers: { Accept: "application/vnd.github+json", "User-Agent": "BXB-Homework" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  const releases = text ? JSON.parse(text) : [];
  const candidates = (Array.isArray(releases) ? releases : [])
    .filter((release) => !release?.draft && !release?.prerelease)
    .map((release) => ({ release, version: extractWindowsReleaseVersion(release) }))
    .filter((item) => item.version)
    .sort((left, right) => compareAppVersions(right.version, left.version));
  const latest = candidates[0] || null;
  if (!latest) return { ok: true, currentVersion, currentChannel: "Windows stable", hasUpdate: false, message: "No Windows stable release was found.", releasesUrl: RELEASES_PAGE_URL };
  const latestVersion = latest.version.raw;
  const installerAsset = chooseAsset(latest.release, ".exe", latestVersion);
  const sha256Asset = installerAsset ? chooseAsset(latest.release, ".sha256", latestVersion) : null;
  const hasUpdate = currentParsed ? compareAppVersions(latest.version, currentParsed) > 0 : latestVersion !== currentVersion;
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
    installerAsset: installerAsset ? { name: installerAsset.name, size: installerAsset.size, downloadUrl: installerAsset.browser_download_url } : null,
    sha256Asset: sha256Asset ? { name: sha256Asset.name, size: sha256Asset.size, downloadUrl: sha256Asset.browser_download_url } : null,
    releasesUrl: RELEASES_PAGE_URL,
    message: hasUpdate ? `Found ${latest.release.name}.` : "Already on the latest Windows stable version.",
  };
}

function publicUpdateState() {
  return { ...updateState, update: updateState.update ? { ...updateState.update } : null };
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  return publicUpdateState();
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadText(url) {
  const response = await fetchUpdateUrl(url, { headers: { "User-Agent": "BXB-Homework-WinUI" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function downloadUpdate() {
  let update = updateState.update;
  if (!update?.hasUpdate) update = await checkForUpdates();
  if (!update?.hasUpdate) return setUpdateState({ status: "idle", update: null, message: update.message });
  if (!update.installerAsset?.downloadUrl || !update.sha256Asset?.downloadUrl) throw new Error("Release 缺少安装包或 SHA256 文件。");
  await fs.mkdir(updateDir, { recursive: true });
  const finalPath = path.join(updateDir, path.basename(update.installerAsset.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_"));
  const tempPath = `${finalPath}.download`;
  setUpdateState({ status: "downloading", update, filePath: finalPath, totalBytes: update.installerAsset.size || 0, downloadedBytes: 0, percent: 0, message: "正在下载安装包..." });
  const response = await fetchUpdateUrl(update.installerAsset.downloadUrl, { headers: { "User-Agent": "BXB-Homework-WinUI" } });
  if (!response.ok) throw new Error(`安装包下载失败 HTTP ${response.status}`);
  const file = createWriteStream(tempPath);
  let downloaded = 0;
  for await (const chunk of response.body) {
    downloaded += chunk.byteLength;
    file.write(chunk);
    setUpdateState({ downloadedBytes: downloaded, percent: update.installerAsset.size ? Math.round((downloaded / update.installerAsset.size) * 100) : 0 });
  }
  await new Promise((resolve, reject) => file.end((error) => (error ? reject(error) : resolve())));
  const expectedSha = String(await downloadText(update.sha256Asset.downloadUrl)).match(/[a-fA-F0-9]{64}/)?.[0]?.toLowerCase();
  const actualSha = await sha256File(tempPath);
  if (expectedSha && expectedSha !== actualSha) throw new Error("安装包 SHA256 校验失败。");
  await fs.rm(finalPath, { force: true });
  await fs.rename(tempPath, finalPath);
  const pending = { version: update.latestVersion, update, size: downloaded, sha256: actualSha, downloadedAt: nowIso(), filePath: finalPath };
  await writeJson(pendingUpdatePath, pending);
  return setUpdateState({ status: "ready_to_install", update, downloadedBytes: downloaded, totalBytes: downloaded, percent: 100, filePath: finalPath, message: "更新已下载并通过校验。" });
}

async function loadPendingUpdateState() {
  const pending = await readJson(pendingUpdatePath, null);
  if (pending?.filePath && existsSync(pending.filePath)) {
    return setUpdateState({ status: "ready_to_install", update: pending.update || null, downloadedBytes: pending.size || 0, totalBytes: pending.size || 0, percent: 100, filePath: pending.filePath, message: "更新已下载并通过校验。" });
  }
  return publicUpdateState();
}

async function installUpdate() {
  const state = await loadPendingUpdateState();
  if (state.status !== "ready_to_install" || !state.filePath) throw new Error("没有已下载并通过校验的更新安装包。");
  const child = spawn(state.filePath, [], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return setUpdateState({ status: "installing", message: "安装器已启动。" });
}

async function appPathTargets() {
  const browserDependency = await getBrowserDependencyStatus();
  return {
    userDataRoot: { path: electronUserDataRoot, kind: "directory", ensure: true },
    dataRoot: { path: dataRoot, kind: "directory", ensure: true },
    workspaceDir: { path: workspaceDir, kind: "directory", ensure: true },
    draftDir: { path: draftDir, kind: "directory", ensure: true },
    updateDir: { path: updateDir, kind: "directory", ensure: true },
    modelConfigPath: { path: modelConfigPath, kind: "file", ensureParent: true },
    conversationsPath: { path: conversationsPath, kind: "file", ensureParent: true },
    payloadRoot: { path: repoRoot, kind: "directory", ensure: false },
    browserRoot: { path: browserDependency.browserRoot, kind: "directory", ensure: false },
  };
}

async function openAppPath(key) {
  const targets = await appPathTargets();
  const target = targets[String(key || "")];
  if (!target?.path) {
    throw new Error("未知路径。");
  }

  if (target.kind === "file") {
    const parent = path.dirname(target.path);
    if (target.ensureParent) await fs.mkdir(parent, { recursive: true });
    if (existsSync(target.path)) {
      spawn("explorer.exe", ["/select,", target.path], { detached: true, stdio: "ignore" }).unref();
      return { ok: true, key, path: target.path };
    }
    spawn("explorer.exe", [parent], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, key, path: parent };
  }

  if (target.ensure) await fs.mkdir(target.path, { recursive: true });
  spawn("explorer.exe", [target.path], { detached: true, stdio: "ignore" }).unref();
  return { ok: true, key, path: target.path };
}

async function appInfo() {
  const browserDependency = await getBrowserDependencyStatus();
  return {
    isPackaged,
    version: await readPackageVersion(),
    nodeVersion: process.version,
    platform: process.platform,
    updateChannel: "Windows stable",
    userDataRoot: electronUserDataRoot,
    dataRoot,
    workspaceDir,
    draftDir,
    updateDir,
    modelConfigPath,
    conversationsPath,
    payloadRoot: repoRoot,
    browserDependency,
  };
}

async function handleRequest(request) {
  const method = String(request?.method || "");
  const params = request?.params && typeof request.params === "object" ? request.params : {};
  if (method === "app.info" || method === "app:info") return appInfo();
  if (method === "app.openPath" || method === "app:open-path") return openAppPath(params.key || params.path || "workspaceDir");
  if (method === "tool.call" || method === "bxb:tool") return callTool(String(params.name || ""), params.args || {});
  if (method === "session.status" || method === "bxb:session") return callTool("session_status", {});
  if (method === "modelConfig.load" || method === "config:model:load") return loadModelConfig();
  if (method === "modelConfig.save" || method === "config:model:save") return saveModelConfig(params.config || params);
  if (method === "modelConfig.clear" || method === "config:model:clear") {
    await fs.rm(modelConfigPath, { force: true });
    return loadModelConfig();
  }
  if (method === "modelConfig.list" || method === "config:model:list") return listModelOptions(params.config || params);
  if (method === "modelConfig.test" || method === "config:model:test") return testModelConfig(params.config || params);
  if (method === "conversation.list" || method === "agent:conversations:list") return listConversations();
  if (method === "conversation.create" || method === "agent:conversations:create") return createConversation(params.title);
  if (method === "conversation.select" || method === "agent:conversations:select") return selectConversation(params.conversationId);
  if (method === "conversation.rename" || method === "agent:conversations:rename") return renameConversation(params.conversationId, params.title);
  if (method === "conversation.delete" || method === "agent:conversations:delete") return deleteConversation(params.conversationId);
  if (method === "agent.chat" || method === "agent:chat") return runAgent(params);
  if (method === "agent.compact" || method === "agent:compact") return compactAgentContext(params.conversationId);
  if (method === "agent.reset" || method === "agent:reset") {
    const { state, conversation } = await getActiveConversation(params.conversationId);
    conversation.messages = [];
    conversation.turns = [];
    conversation.updatedAt = nowIso();
    await saveConversationState(state);
    return { ok: true };
  }
  if (method === "workspace.importPaths" || method === "workspace:import") return importWorkspacePaths(params.paths || []);
  if (method === "workspace.savePastes" || method === "workspace:save-pastes") return saveWorkspacePastes(params.items);
  if (method === "workspace.open" || method === "workspace:open") return openAppPath("workspaceDir");
  if (method === "workspace.imageDataUrl" || method === "workspace:image-data-url") return getWorkspaceImageDataUrl(params.filePath);
  if (method === "update.check" || method === "update:check") {
    const result = await checkForUpdates();
    setUpdateState({ status: result.ok && result.hasUpdate ? "available" : result.ok ? "idle" : "error", update: result.ok && result.hasUpdate ? result : null, message: result.message, totalBytes: result.installerAsset?.size || 0 });
    return result;
  }
  if (method === "update.status" || method === "update:status") return loadPendingUpdateState();
  if (method === "update.download" || method === "update:download") return downloadUpdate();
  if (method === "update.install" || method === "update:install") return installUpdate();
  if (method === "update.cancel" || method === "update:cancel") return setUpdateState({ status: "idle", message: "下载已取消。" });
  if (method === "update.openUrl" || method === "update:open-url") {
    spawn("cmd.exe", ["/c", "start", "", String(params.url || RELEASES_PAGE_URL)], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, url: String(params.url || RELEASES_PAGE_URL) };
  }
  throw new Error(`Unknown WinUI backend method: ${method}`);
}

let pending = "";
let activeRequests = 0;
let stdinEnded = false;

function finishRequest() {
  activeRequests -= 1;
  if (stdinEnded && activeRequests === 0) process.exit(0);
}

async function handleRequestLine(line) {
  let request;
  activeRequests += 1;
  try {
    request = JSON.parse(line);
    const result = await handleRequest(request);
    writeResponse({ id: request.id ?? null, ok: true, result });
  } catch (error) {
    writeResponse({ id: request?.id ?? null, ok: false, error: { message: error?.message || String(error), stack: error?.stack || "" } });
  } finally {
    finishRequest();
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  const lines = pending.split(/\r?\n/);
  pending = lines.pop() || "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) void handleRequestLine(trimmed);
  }
});
process.stdin.on("end", () => {
  stdinEnded = true;
  if (pending.trim()) {
    const lastLine = pending.trim();
    pending = "";
    void handleRequestLine(lastLine);
    return;
  }
  if (activeRequests === 0) process.exit(0);
});

process.stderr.write("bxb-winui-backend running on JSONL stdio\n");
