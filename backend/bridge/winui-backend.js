import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { BanxuebangClient } from "../src/banxuebang-client.js";
import { DraftStore, migrateDraftFiles } from "../src/draft-store.js";
import {
  contextBudget,
  contextDefaults,
  estimateMessagesTokens,
  flattenRounds,
  normalizeContextState,
  splitIntoRounds,
  splitRecentRounds,
  summaryMessage,
} from "../src/context-manager.js";
import { SessionStore } from "../src/session-store.js";
import { createToolDefinitions, executeTool } from "../src/tool-definitions.js";
import {
  CORE_AGENT_SYSTEM_PROMPT,
  DEFAULT_CUSTOM_INSTRUCTIONS,
  IMAGE_TRANSCRIPTION_SYSTEM_PROMPT,
  PDF_VISION_SYSTEM_PROMPT,
  buildAgentSystemPrompt,
  buildContextSummaryPrompt,
  buildImageVisionRequest,
  buildPdfVisionRequest,
  normalizeCustomInstructions,
} from "../src/agent-prompts.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..");
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
const DEFAULT_PDF_VISION_MAX_PAGES = 12;
const MAX_PDF_VISION_PAGES = 30;
const PDF_VISION_BATCH_SIZE = 4;
const PDF_VISION_PAGE_WIDTH = 1280;
const MAX_AGENT_INPUT_IMAGES = 8;
const MAX_AGENT_INPUT_IMAGE_BYTES = 25 * 1024 * 1024;
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
process.env.BANXUEBANG_SESSION_FILE = sessionFile;
process.env.BANXUEBANG_DRAFT_DIR = draftDir;
process.env.BANXUEBANG_WORKSPACE_DIR = workspaceDir;

await migrateDraftFiles(
  [path.join(repoRoot, ".banxuebang", "drafts"), path.join(process.cwd(), ".banxuebang", "drafts")],
  draftDir,
);

const client = new BanxuebangClient(new SessionStore(sessionFile), new DraftStore(draftDir));
const toolDefinitions = createToolDefinitions(client);
let conversationStatePromise = null;
const conversationLocks = new Map();
const activeAgentRuns = new Map();
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

function normalizeProviderId(value, fallback = "") {
  const id = String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return id || fallback || `provider_${safeId()}`;
}

function normalizeModelRole(value, fallback = "chat") {
  const role = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (role === "image" || role === "images" || role === "vision" || role === "caption" || role === "image_caption" || role === "image_transcription") {
    return "image_caption";
  }
  if (role === "chat" || role === "agent" || role === "conversation") {
    return "chat";
  }
  return fallback;
}

function normalizeProvider(provider, fallbackId = "") {
  const source = provider && typeof provider === "object" ? provider : {};
  const id = normalizeProviderId(source.id || source.providerId, fallbackId);
  const baseUrl = String(source.baseUrl || source.apiBaseUrl || source.endpoint || "").trim();
  const modelName = String(source.modelName || source.model || source.defaultModel || "").trim();
  const type = String(source.type || source.providerType || "openai").trim() || "openai";
  const name = String(source.name || source.label || source.providerName || "").trim()
    || (modelName ? `${modelName}` : "")
    || (baseUrl ? baseUrl.replace(/^https?:\/\//, "").replace(/\/v1\/?$/, "") : "")
    || "默认提供商";
  return {
    id,
    type,
    name,
    apiKey: String(source.apiKey || "").trim(),
    baseUrl,
    modelName,
    availableModels: Array.isArray(source.availableModels) ? source.availableModels.map((item) => String(item || "").trim()).filter(Boolean) : [],
  };
}

function normalizeProviderList(sourceProviders) {
  const providers = [];
  const seen = new Set();
  for (const provider of Array.isArray(sourceProviders) ? sourceProviders : []) {
    const normalized = normalizeProvider(provider);
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    providers.push(normalized);
  }
  return providers;
}

function rawModelRole(source, role) {
  const rawRoles = source.modelRoles && typeof source.modelRoles === "object" ? source.modelRoles : {};
  if (role === "chat") {
    return rawRoles.chat && typeof rawRoles.chat === "object" ? rawRoles.chat : {};
  }
  return rawRoles.image_caption && typeof rawRoles.image_caption === "object"
    ? rawRoles.image_caption
    : rawRoles.imageCaption && typeof rawRoles.imageCaption === "object"
      ? rawRoles.imageCaption
      : {};
}

function normalizeModelRoles(source, chatProviders, imageProviders, fallbackChatId) {
  const chatRole = rawModelRole(source, "chat");
  const imageRole = rawModelRole(source, "image_caption");
  const pickProviderId = (value, providers, fallback = "") => {
    if (!providers.length) return "";
    const providerId = normalizeProviderId(value, fallback || providers[0].id);
    return providers.some((provider) => provider.id === providerId) ? providerId : fallback || providers[0].id;
  };

  const chatProviderId = pickProviderId(
    chatRole.activeProviderId || chatRole.providerId || source.activeProviderId || source.providerId,
    chatProviders,
    fallbackChatId,
  );
  const imageProviderId = pickProviderId(
    imageRole.activeProviderId || imageRole.providerId || source.imageCaptionProviderId || source.captionProviderId,
    imageProviders,
  );
  return {
    chat: {
      enabled: true,
      activeProviderId: chatProviderId,
      providers: chatProviders,
    },
    image_caption: {
      enabled: imageRole.enabled === true,
      activeProviderId: imageProviderId,
      providers: imageProviders,
    },
  };
}

function normalizeModelConfig(rawConfig) {
  const source = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const rawChatRole = rawModelRole(source, "chat");
  const rawImageRole = rawModelRole(source, "image_caption");
  const chatSourceProviders = Array.isArray(rawChatRole.providers)
    ? rawChatRole.providers
    : Array.isArray(source.providers)
      ? source.providers
      : [];
  const imageSourceProviders = Array.isArray(rawImageRole.providers) ? rawImageRole.providers : [];
  const providers = normalizeProviderList(chatSourceProviders);
  const imageProviders = normalizeProviderList(imageSourceProviders);

  if (!providers.length) {
    const legacy = normalizeProvider({
      id: providers.length ? source.activeProviderId : "default",
      name: source.providerName || source.name || "默认提供商",
      apiKey: source.apiKey,
      baseUrl: source.baseUrl,
      modelName: source.modelName,
    }, "default");
    const existingIndex = providers.findIndex((provider) => provider.id === legacy.id);
    if (existingIndex >= 0) {
      providers[existingIndex] = {
        ...providers[existingIndex],
        apiKey: legacy.apiKey || providers[existingIndex].apiKey,
        baseUrl: legacy.baseUrl || providers[existingIndex].baseUrl,
        modelName: legacy.modelName || providers[existingIndex].modelName,
      };
    } else if (legacy.apiKey || legacy.baseUrl || legacy.modelName || !providers.length) {
      providers.unshift(legacy);
    }
  }

  if (!providers.length) {
    providers.push(normalizeProvider({ id: "default", name: "默认提供商" }, "default"));
  }

  const requestedActiveId = normalizeProviderId(source.activeProviderId || source.providerId, providers[0].id);
  const activeProvider = providers.find((provider) => provider.id === requestedActiveId)
    || providers.find((provider) => provider.baseUrl || provider.modelName)
    || providers[0];
  const modelRoles = normalizeModelRoles(source, providers, imageProviders, activeProvider.id);

  return {
    activeProviderId: modelRoles.chat.activeProviderId,
    modelRoles,
    providers,
    apiKey: getActiveProvider({ providers, activeProviderId: modelRoles.chat.activeProviderId, modelRoles }, "chat").apiKey,
    baseUrl: getActiveProvider({ providers, activeProviderId: modelRoles.chat.activeProviderId, modelRoles }, "chat").baseUrl,
    modelName: getActiveProvider({ providers, activeProviderId: modelRoles.chat.activeProviderId, modelRoles }, "chat").modelName,
    providerName: getActiveProvider({ providers, activeProviderId: modelRoles.chat.activeProviderId, modelRoles }, "chat").name,
    contextLength: Number.parseInt(source.contextLength ?? 0, 10) || 0,
    chatTemperature: normalizeTemperature(source.chatTemperature, 0.2),
    compactTemperature: normalizeTemperature(source.compactTemperature, 0.1),
    longPasteThreshold: normalizeLongPasteThreshold(source.longPasteThreshold, 4000),
    maxToolRounds: Math.max(1, Number.parseInt(source.maxToolRounds ?? 6, 10) || 6),
    theme: normalizeTheme(source.theme),
    customInstructions: normalizeCustomInstructions(source),
  };
}

function getRoleProviderId(config, role = "chat") {
  const normalizedRole = normalizeModelRole(role);
  const roleProviderId = config.modelRoles?.[normalizedRole]?.activeProviderId;
  if (roleProviderId) return roleProviderId;
  return normalizedRole === "chat" ? config.activeProviderId : "";
}

function getRoleProviders(config, role = "chat") {
  const normalizedRole = normalizeModelRole(role);
  const roleProviders = config.modelRoles?.[normalizedRole]?.providers;
  if (Array.isArray(roleProviders)) return roleProviders;
  return normalizedRole === "chat" && Array.isArray(config.providers) ? config.providers : [];
}

function getActiveProvider(config, role = "chat") {
  const providerId = getRoleProviderId(config, role);
  const providers = getRoleProviders(config, role);
  return providers.find((provider) => provider.id === providerId) || providers[0] || normalizeProvider({ id: "default", name: "默认提供商" });
}

function modelConfigForStorage(config) {
  const normalized = normalizeModelConfig(config);
  const active = getActiveProvider(normalized, "chat");
  return {
    activeProviderId: active.id,
    modelRoles: normalized.modelRoles,
    providers: normalized.providers,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    modelName: active.modelName,
    providerName: active.name,
    contextLength: normalized.contextLength,
    chatTemperature: normalized.chatTemperature,
    compactTemperature: normalized.compactTemperature,
    longPasteThreshold: normalized.longPasteThreshold,
    maxToolRounds: normalized.maxToolRounds,
    theme: normalized.theme,
    customInstructions: normalized.customInstructions,
  };
}

async function readModelConfigInternal() {
  return normalizeModelConfig(await readJson(modelConfigPath, {}));
}

async function loadModelConfig() {
  return publicModelConfig(await readModelConfigInternal());
}

function publicModelConfig(config) {
  const active = getActiveProvider(config, "chat");
  const publicProvider = (provider) => ({
    id: provider.id,
    type: provider.type,
    name: provider.name,
    baseUrl: provider.baseUrl,
    modelName: provider.modelName,
    availableModels: provider.availableModels,
    hasApiKey: Boolean(provider.apiKey),
    apiKeyMasked: maskKey(provider.apiKey),
  });
  const publicRoles = Object.fromEntries(Object.entries(config.modelRoles || {}).map(([role, value]) => [
    role,
    {
      enabled: value?.enabled === true,
      activeProviderId: value?.activeProviderId || "",
      providers: getRoleProviders(config, role).map(publicProvider),
    },
  ]));
  return {
    ...config,
    apiKey: "",
    hasApiKey: Boolean(active.apiKey),
    apiKeyMasked: maskKey(active.apiKey),
    baseUrl: active.baseUrl,
    modelName: active.modelName,
    providerName: active.name,
    modelRoles: publicRoles,
    providers: config.providers.map(publicProvider),
    customInstructions: config.customInstructions,
    coreSystemPrompt: CORE_AGENT_SYSTEM_PROMPT,
    defaultCustomInstructions: DEFAULT_CUSTOM_INSTRUCTIONS,
    effectiveSystemPrompt: buildAgentSystemPrompt(config.customInstructions),
    systemPrompt: buildAgentSystemPrompt(config.customInstructions),
    defaultSystemPrompt: CORE_AGENT_SYSTEM_PROMPT,
    configPath: modelConfigPath,
  };
}

function mergeProvider(existingProvider, incomingProvider = {}, topLevelConfig = {}) {
  const hasProviderKey = Object.prototype.hasOwnProperty.call(incomingProvider, "apiKey");
  const hasTopLevelKey = Object.prototype.hasOwnProperty.call(topLevelConfig, "apiKey");
  return normalizeProvider({
    id: incomingProvider.id || incomingProvider.providerId || topLevelConfig.activeProviderId || existingProvider.id,
    type: incomingProvider.type ?? incomingProvider.providerType ?? topLevelConfig.providerType ?? existingProvider.type,
    name: incomingProvider.name ?? incomingProvider.providerName ?? topLevelConfig.providerName ?? existingProvider.name,
    apiKey: hasProviderKey
      ? incomingProvider.apiKey
      : hasTopLevelKey
        ? topLevelConfig.apiKey
        : existingProvider.apiKey,
    baseUrl: incomingProvider.baseUrl ?? topLevelConfig.baseUrl ?? existingProvider.baseUrl,
    modelName: incomingProvider.modelName ?? incomingProvider.model ?? topLevelConfig.modelName ?? existingProvider.modelName,
    availableModels: incomingProvider.availableModels ?? existingProvider.availableModels,
  }, existingProvider.id);
}

async function saveModelConfig(config) {
  const existing = await readModelConfigInternal();
  const incoming = config && typeof config === "object" ? config : {};
  const modelRole = normalizeModelRole(incoming.modelRole || incoming.role || "chat");
  let roleProviders = [...getRoleProviders(existing, modelRole)];
  const existingRoleProviderId = getRoleProviderId(existing, modelRole);
  const requestedProviderId = incoming.activeProviderId || incoming.providerId || "";
  let activeProviderId = requestedProviderId
    ? normalizeProviderId(requestedProviderId, existingRoleProviderId)
    : existingRoleProviderId;

  if (incoming.provider && typeof incoming.provider === "object") {
    activeProviderId = normalizeProviderId(
      incoming.provider.id || incoming.provider.providerId || activeProviderId,
      activeProviderId || `provider_${safeId()}`,
    );
  }

  const shouldUpdateProvider = Boolean(incoming.provider)
    || Object.prototype.hasOwnProperty.call(incoming, "apiKey")
    || Object.prototype.hasOwnProperty.call(incoming, "baseUrl")
    || Object.prototype.hasOwnProperty.call(incoming, "modelName")
    || Object.prototype.hasOwnProperty.call(incoming, "providerName");
  let providerIndex = roleProviders.findIndex((provider) => provider.id === activeProviderId);
  if (providerIndex < 0 && shouldUpdateProvider) {
    activeProviderId = activeProviderId || `provider_${safeId()}`;
    roleProviders.push(normalizeProvider({ id: activeProviderId, name: incoming.providerName || "新提供商" }, activeProviderId));
    providerIndex = roleProviders.length - 1;
  }
  if (shouldUpdateProvider) {
    roleProviders[providerIndex] = mergeProvider(roleProviders[providerIndex], incoming.provider || {}, incoming);
  }

  const existingRole = existing.modelRoles?.[modelRole] || {};
  const enabled = modelRole === "image_caption"
    ? (typeof incoming.enabled === "boolean" ? incoming.enabled : existingRole.enabled === true)
    : true;
  const nextRole = {
    ...existingRole,
    enabled,
    activeProviderId: activeProviderId || "",
    providers: roleProviders,
  };
  const normalized = modelConfigForStorage({
    ...existing,
    providers: modelRole === "chat" ? roleProviders : existing.providers,
    activeProviderId: modelRole === "chat" ? activeProviderId : existing.activeProviderId,
    modelRoles: {
      ...existing.modelRoles,
      [modelRole]: nextRole,
    },
    contextLength: incoming.contextLength ?? existing.contextLength,
    chatTemperature: incoming.chatTemperature ?? existing.chatTemperature,
    compactTemperature: incoming.compactTemperature ?? existing.compactTemperature,
    longPasteThreshold: incoming.longPasteThreshold ?? existing.longPasteThreshold,
    maxToolRounds: incoming.maxToolRounds ?? existing.maxToolRounds,
    theme: incoming.theme ?? existing.theme,
    customInstructions: Object.prototype.hasOwnProperty.call(incoming, "customInstructions")
      ? incoming.customInstructions
      : Object.prototype.hasOwnProperty.call(incoming, "systemPrompt")
        ? normalizeCustomInstructions(incoming)
        : existing.customInstructions,
  });
  await writeJson(modelConfigPath, normalized);
  return loadModelConfig();
}

async function createModelProvider({ name, type, baseUrl, apiKey, modelName, modelRole } = {}) {
  const existing = await readModelConfigInternal();
  const role = normalizeModelRole(modelRole || "chat");
  const roleProviders = getRoleProviders(existing, role);
  const provider = normalizeProvider({
    id: `provider_${safeId()}`,
    type: String(type || "openai").trim() || "openai",
    name: String(name || "").trim() || `提供商 ${roleProviders.length + 1}`,
    baseUrl,
    apiKey,
    modelName,
  });
  const normalized = modelConfigForStorage({
    ...existing,
    providers: role === "chat" ? [...roleProviders, provider] : existing.providers,
    activeProviderId: role === "chat" ? provider.id : existing.activeProviderId,
    modelRoles: {
      ...existing.modelRoles,
      [role]: {
        ...(existing.modelRoles?.[role] || {}),
        enabled: role === "image_caption" ? true : true,
        activeProviderId: provider.id,
        providers: [...roleProviders, provider],
      },
    },
  });
  await writeJson(modelConfigPath, normalized);
  return loadModelConfig();
}

async function deleteModelProvider({ providerId, modelRole } = {}) {
  const existing = await readModelConfigInternal();
  const role = normalizeModelRole(modelRole || "chat");
  const roleProviders = getRoleProviders(existing, role);
  const targetId = providerId ? normalizeProviderId(providerId, providerId) : getRoleProviderId(existing, role);
  let providers = roleProviders.filter((provider) => provider.id !== targetId);
  if (role === "chat" && !providers.length) {
    providers = [normalizeProvider({ id: "default", name: "默认提供商" }, "default")];
  }
  const nextActiveProviderId = providers.find((provider) => provider.id === getRoleProviderId(existing, role))?.id
    || providers[0]?.id
    || "";
  const normalized = modelConfigForStorage({
    ...existing,
    providers: role === "chat" ? providers : existing.providers,
    activeProviderId: role === "chat" ? nextActiveProviderId : existing.activeProviderId,
    modelRoles: Object.fromEntries(Object.entries(existing.modelRoles || {}).map(([role, value]) => [
      role,
      role === normalizeModelRole(modelRole || "chat")
        ? { ...(value || {}), activeProviderId: nextActiveProviderId, providers }
        : value,
    ])),
  });
  await writeJson(modelConfigPath, normalized);
  return loadModelConfig();
}

function resolveModelCandidate(saved, config) {
  const incoming = config && typeof config === "object" ? config : {};
  const modelRole = normalizeModelRole(incoming.modelRole || incoming.role || "chat");
  const fallbackProviderId = getRoleProviderId(saved, modelRole) || saved.activeProviderId;
  const providerId = normalizeProviderId(incoming.activeProviderId || incoming.providerId || incoming.provider?.id || fallbackProviderId, fallbackProviderId);
  const existingProvider = getRoleProviders(saved, modelRole).find((provider) => provider.id === providerId) || getActiveProvider(saved, modelRole);
  return mergeProvider(existingProvider, incoming.provider || {}, incoming);
}

async function listModelOptions(config) {
  const saved = await readModelConfigInternal();
  const candidate = resolveModelCandidate(saved, config);
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
  const modelRole = normalizeModelRole(config?.modelRole || config?.role || "chat");
  await saveModelConfig(config);
  const saved = await readModelConfigInternal();
  const candidate = getActiveProvider(saved, modelRole);
  if (!candidate.apiKey || !candidate.baseUrl || !candidate.modelName) {
    throw new Error("请先填写 API Key、调用链接和模型名称。");
  }
  const listed = await listModelOptions({ ...candidate, modelRole });
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
  return {
    id: safeId(),
    title,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    turns: [],
    contextState: normalizeContextState(),
  };
}

function normalizeConversationMessage(message) {
  const source = message && typeof message === "object" ? message : {};
  const interrupted = source.isRunning === true;
  const text = String(source.text ?? source.content ?? source.message ?? "");
  return {
    ...source,
    id: String(source.id || safeId()),
    role: String(source.role || "") === "user" ? "user" : "assistant",
    text: interrupted && !text ? "上次生成在应用退出前中断。" : text,
    at: String(source.at || source.createdAt || nowIso()),
    steps: Array.isArray(source.steps) ? source.steps : [],
    isRunning: false,
    status: interrupted ? "interrupted" : String(source.status || "completed"),
  };
}

function normalizeConversation(raw) {
  const fallback = newConversation();
  const turns = Array.isArray(raw?.turns) ? [...raw.turns] : [];
  const contextState = normalizeContextState(raw?.contextState);
  const legacySummary = turns[0]?.role === "system"
    ? String(turns[0]?.content || "").match(/^此前对话(?:的)?压缩摘要：\s*([\s\S]*)$/)?.[1]?.trim()
    : "";
  if (legacySummary) {
    if (!contextState.summary) contextState.summary = legacySummary;
    turns.shift();
  }
  return {
    id: String(raw?.id || fallback.id),
    title: String(raw?.title || "新对话"),
    createdAt: String(raw?.createdAt || fallback.createdAt),
    updatedAt: String(raw?.updatedAt || raw?.createdAt || fallback.updatedAt),
    messages: Array.isArray(raw?.messages) ? raw.messages.map(normalizeConversationMessage) : [],
    turns,
    contextState,
  };
}

function buildAgentMessages(config, conversation, runtimeMessages = []) {
  const compacted = summaryMessage(conversation.contextState?.summary);
  return [
    { role: "system", content: buildAgentSystemPrompt(config.customInstructions) },
    ...(compacted ? [compacted] : []),
    ...conversation.turns,
    ...runtimeMessages,
  ];
}

function conversationContextInfo(conversation, config) {
  const estimatedTokens = estimateMessagesTokens(buildAgentMessages(config, conversation), safeToolSchemas());
  const budget = contextBudget(config.contextLength);
  conversation.contextState = {
    ...normalizeContextState(conversation.contextState),
    estimatedTokens,
    contextLength: budget.limit,
  };
  const lastPromptTokens = conversation.contextState.lastPromptTokens;
  const currentTokens = Math.max(estimatedTokens, lastPromptTokens);
  return {
    estimatedTokens,
    lastPromptTokens,
    currentTokens,
    contextLength: budget.limit,
    usagePercent: budget.limit ? Math.min(100, Math.round((currentTokens / budget.limit) * 100)) : 0,
    autoCompressionEnabled: budget.limit > 0,
    triggerTokens: budget.triggerTokens,
    targetTokens: budget.targetTokens,
    compactionCount: conversation.contextState.compactionCount,
    lastCompactedAt: conversation.contextState.lastCompactedAt,
    lastCompactionReason: conversation.contextState.lastCompactionReason,
    lastBeforeTokens: conversation.contextState.lastBeforeTokens,
    lastAfterTokens: conversation.contextState.lastAfterTokens,
  };
}

function conversationSummary(conversation, config) {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    ...(config ? { context: conversationContextInfo(conversation, config) } : {}),
  };
}

function conversationForRenderer(conversation, config) {
  return conversation ? { ...conversationSummary(conversation, config), messages: conversation.messages } : null;
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
  const config = await readModelConfigInternal();
  const active = state.conversations.find((item) => item.id === state.activeId) || state.conversations[0];
  return {
    activeId: active?.id || null,
    conversations: state.conversations.map((conversation) => conversationSummary(conversation, config)),
    activeConversation: conversationForRenderer(active, config),
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

async function callTool(name, args = {}, { signal } = {}) {
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
  throwIfAgentAborted(signal);
  const result = await waitForAgentOperation(executeTool(toolDefinitions, name, args || {}), signal);
  throwIfAgentAborted(signal);
  return waitForAgentOperation(enhanceReadableToolResult(name, args || {}, result, { signal }), signal);
}

function normalizePdfPageNumbers(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item) && item > 0)));
}

function pdfResultContainer(name, result) {
  if (name === "extract_pdf_text") return result;
  if (name === "read_workspace_file") return result?.file;
  if (name === "read_task_attachment") return result?.read;
  return null;
}

async function renderPdfPages(filePath, { pageNumbers = [], maxPages = DEFAULT_PDF_VISION_MAX_PAGES } = {}) {
  const pdfParseModule = await import("pdf-parse");
  const PDFParse = pdfParseModule.PDFParse || pdfParseModule.default?.PDFParse;
  if (typeof PDFParse !== "function") throw new Error("pdf-parse 未提供 PDF 页面渲染能力。");

  const parser = new PDFParse({ data: await fs.readFile(filePath) });
  try {
    const options = {
      desiredWidth: PDF_VISION_PAGE_WIDTH,
      imageDataUrl: true,
      imageBuffer: false,
      ...(pageNumbers.length ? { partial: pageNumbers } : { first: maxPages }),
    };
    const screenshots = await parser.getScreenshot(options);
    return {
      pages: screenshots.pages || [],
      totalPages: Number.parseInt(screenshots.total, 10) || screenshots.pages?.length || 0,
    };
  } finally {
    await parser.destroy();
  }
}

function pdfVisionRoute(config) {
  const imageRoleEnabled = config.modelRoles?.image_caption?.enabled === true;
  const role = imageRoleEnabled ? "image_caption" : "chat";
  const provider = getActiveProvider(config, role);
  if (!provider.apiKey || !provider.baseUrl || !provider.modelName) {
    throw new Error(imageRoleEnabled
      ? "图片转述已启用，但当前图片转述提供商配置不完整。"
      : "图片转述未启用，PDF 图片将交给主模型，但当前主模型配置不完整。");
  }
  return {
    role,
    route: imageRoleEnabled ? "image_caption" : "chat_multimodal",
    provider,
  };
}

async function requestPdfVisionBatch(route, fileName, pages, signal) {
  const content = [{
    type: "text",
    text: buildPdfVisionRequest(fileName),
  }];
  for (const page of pages) {
    content.push({ type: "text", text: `第 ${page.pageNumber} 页` });
    content.push({ type: "image_url", image_url: { url: page.dataUrl, detail: "high" } });
  }

  const response = await fetch(deriveChatUrl(route.provider.baseUrl), {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${route.provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: route.provider.modelName,
      messages: [
        { role: "system", content: PDF_VISION_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: chatTemperature(route.provider, 0.1),
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`视觉模型返回 HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const text = summaryResponseText(raw ? JSON.parse(raw) : {});
  if (!text) throw new Error("视觉模型没有返回可用的 PDF 页面描述。");
  return text;
}

async function requestImageVisionBatch(route, images, signal) {
  const content = [{ type: "text", text: buildImageVisionRequest() }];
  for (const image of images) {
    content.push({ type: "text", text: `图片：${image.fileName}` });
    content.push({ type: "image_url", image_url: { url: image.dataUrl, detail: "high" } });
  }

  const response = await fetch(deriveChatUrl(route.provider.baseUrl), {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${route.provider.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: route.provider.modelName,
      messages: [
        { role: "system", content: IMAGE_TRANSCRIPTION_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      temperature: chatTemperature(route.provider, 0.1),
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`视觉模型返回 HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const text = summaryResponseText(raw ? JSON.parse(raw) : {});
  if (!text) throw new Error("视觉模型没有返回可用的图片描述。");
  return text;
}

async function loadWorkspaceImages(attachments) {
  const source = Array.isArray(attachments) ? attachments : [];
  if (source.length > MAX_AGENT_INPUT_IMAGES) throw new Error(`每条消息最多附带 ${MAX_AGENT_INPUT_IMAGES} 张图片。`);
  const entries = source;
  const images = [];
  for (const entry of entries) {
    const requestedPath = entry?.path
      || (entry?.relativePath ? path.join(workspaceDir, String(entry.relativePath)) : "");
    if (!requestedPath) throw new Error("附带图片缺少工作区路径。");
    const image = await getWorkspaceImageDataUrl(requestedPath);
    if (image.sizeBytes > MAX_AGENT_INPUT_IMAGE_BYTES) throw new Error(`图片“${image.fileName}”超过 25 MB。`);
    images.push({
      fileName: image.fileName,
      path: image.path,
      relativePath: path.relative(workspaceDir, image.path).replaceAll("\\", "/"),
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: image.dataUrl,
    });
  }
  return images;
}

async function describeLoadedImages(config, images, signal) {
  const route = pdfVisionRoute(config);
  const descriptions = [];
  for (let index = 0; index < images.length; index += PDF_VISION_BATCH_SIZE) {
    descriptions.push(await requestImageVisionBatch(route, images.slice(index, index + PDF_VISION_BATCH_SIZE), signal));
  }
  return {
    ok: true,
    route: route.route,
    role: route.role,
    providerName: route.provider.name,
    modelName: route.provider.modelName,
    images: images.map(({ fileName, relativePath, mimeType, sizeBytes }) => ({ fileName, relativePath, mimeType, sizeBytes })),
    text: descriptions.join("\n\n"),
  };
}

async function describePdfVisuals(filePath, args = {}, { signal } = {}) {
  const config = await readModelConfigInternal();
  const route = pdfVisionRoute(config);
  const requestedMax = Number.parseInt(args.max_pages, 10);
  const maxPages = Math.min(MAX_PDF_VISION_PAGES, Math.max(1, requestedMax || DEFAULT_PDF_VISION_MAX_PAGES));
  const allRequestedPages = normalizePdfPageNumbers(args.page_numbers);
  const requestedPages = allRequestedPages.slice(0, maxPages);
  const rendered = await renderPdfPages(filePath, { pageNumbers: requestedPages, maxPages });
  const descriptions = [];
  for (let index = 0; index < rendered.pages.length; index += PDF_VISION_BATCH_SIZE) {
    descriptions.push(await requestPdfVisionBatch(
      route,
      path.basename(filePath),
      rendered.pages.slice(index, index + PDF_VISION_BATCH_SIZE),
      signal,
    ));
  }

  const analyzedPages = rendered.pages.map((page) => page.pageNumber);
  const fullText = descriptions.join("\n\n");
  const requestedTextLimit = Number.parseInt(args.max_chars, 10);
  const textLimit = Math.min(12000, Math.max(1000, requestedTextLimit || 6000));
  return {
    ok: true,
    route: route.route,
    role: route.role,
    providerName: route.provider.name,
    modelName: route.provider.modelName,
    totalPages: rendered.totalPages,
    requestedPages: allRequestedPages,
    analyzedPages,
    omittedRequestedPages: allRequestedPages.slice(requestedPages.length),
    omittedPages: Math.max(0, rendered.totalPages - analyzedPages.length),
    pagesTruncated: rendered.totalPages > analyzedPages.length || allRequestedPages.length > requestedPages.length,
    textTruncated: fullText.length > textLimit,
    truncated: rendered.totalPages > analyzedPages.length
      || allRequestedPages.length > requestedPages.length
      || fullText.length > textLimit,
    text: fullText.slice(0, textLimit),
  };
}

async function enhanceReadableToolResult(name, args, result, { signal } = {}) {
  const container = pdfResultContainer(name, result);
  if (!container || !container.path) return result;
  const extension = String(container.extension || "").toLowerCase();
  const isPdf = extension === ".pdf";
  const isImage = IMAGE_MIME_BY_EXTENSION.has(extension);
  if (!isPdf && !isImage) return result;

  let visualAnalysis;
  try {
    visualAnalysis = isPdf
      ? await describePdfVisuals(container.path, args, { signal })
      : await describeLoadedImages(await readModelConfigInternal(), [{
          ...(await getLocalImageDataUrl(container.path)),
          relativePath: path.relative(workspaceDir, container.path).replaceAll("\\", "/"),
        }], signal);
  } catch (error) {
    visualAnalysis = { ok: false, error: String(error?.message || error || "图片分析失败。") };
  }

  if (name === "read_workspace_file") return { ...result, file: { ...container, visualAnalysis } };
  if (name === "read_task_attachment") return { ...result, read: { ...container, visualAnalysis } };
  return { ...result, visualAnalysis };
}

function safeToolSchemas() {
  const tools = [
    { name: "session_status", description: "读取当前伴学邦登录状态和上下文。", parameters: { type: "object", properties: {} } },
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
      description: "下载并读取任务附件。PDF 会提取文本并逐页进行视觉分析，图片会进行视觉分析；无需重复读取。",
      parameters: {
        type: "object",
        properties: {
          task_id: { type: "string" },
          file_id: { type: "string" },
          max_chars: { type: "number" },
          directory: { type: "string" },
          max_pages: { type: "number", description: "PDF 视觉分析最大页数，默认 12，最大 30。" },
          page_numbers: { type: "array", items: { type: "integer" }, description: "可选，只分析指定 PDF 页码。" },
        },
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
      description: "读取工作区文件内容。PDF 会提取文本并逐页进行视觉分析，普通图片会返回 visualAnalysis。",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string" },
          max_chars: { type: "number" },
          max_pages: { type: "number", description: "PDF 视觉分析最大页数，默认 12，最大 30。" },
          page_numbers: { type: "array", items: { type: "integer" }, description: "可选，只分析指定 PDF 页码。" },
        },
        required: ["file"],
      },
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
      description: "提取本地 PDF 文本并逐页进行视觉分析；返回结果的 visualAnalysis 说明使用的模型角色、页码和图片转述。",
      parameters: {
        type: "object",
        properties: {
          local_path: { type: "string" },
          max_chars: { type: "number" },
          max_pages: { type: "number", description: "视觉分析最大页数，默认 12，最大 30。" },
          page_numbers: { type: "array", items: { type: "integer" }, description: "可选，只分析指定页码。" },
        },
        required: ["local_path"],
      },
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

async function withConversationLock(conversationId, operation) {
  const state = await loadConversationState();
  const key = String(conversationId || state.activeId || "__active_conversation__");
  const previous = conversationLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  conversationLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (conversationLocks.get(key) === queued) conversationLocks.delete(key);
  }
}

function throwIfAgentAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("用户已停止生成。");
  error.name = "AbortError";
  throw error;
}

function isAgentAbort(error, signal) {
  return signal?.aborted === true || error?.name === "AbortError";
}

async function waitForAgentOperation(operation, signal) {
  if (!signal) return operation;
  throwIfAgentAborted(signal);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => {
      const error = new Error("用户已停止生成。");
      error.name = "AbortError";
      reject(error);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function usagePromptTokens(usage) {
  return Math.max(0, Number.parseInt(usage?.prompt_tokens ?? usage?.promptTokens, 10) || 0);
}

function summaryResponseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => String(part?.text || part?.content || "")).join("\n").trim();
  }
  return "";
}

function isContextLimitError(status, body) {
  if (status !== 400 && status !== 413) return false;
  return /context.{0,24}(length|window|limit)|maximum context|too many tokens|token.{0,16}(limit|maximum)|上下文.{0,12}(超|限制)/i.test(String(body || ""));
}

function agentImageReferenceText(images) {
  if (!images.length) return "";
  return [
    "本条消息附带以下工作区图片，请结合图片内容回答：",
    ...images.map((image) => `- ${image.relativePath}（${image.fileName}）`),
  ].join("\n");
}

function agentUserDisplayText(text, images) {
  return [
    String(text || "").trim(),
    ...images.map((image) => `[图片] ${image.fileName}`),
  ].filter(Boolean).join("\n");
}

function agentMultimodalContent(text, images) {
  return [
    { type: "text", text },
    ...images.flatMap((image) => [
      { type: "text", text: `图片：${image.fileName}` },
      { type: "image_url", image_url: { url: image.dataUrl, detail: "high" } },
    ]),
  ];
}

async function requestContextSummary(config, previousSummary, turns, maxSummaryChars, signal) {
  const instruction = buildContextSummaryPrompt(maxSummaryChars);
  const response = await fetch(deriveChatUrl(config.baseUrl), {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.modelName,
      messages: [
        { role: "system", content: instruction },
        {
          role: "user",
          content: JSON.stringify({
            previousSummary: String(previousSummary || "").trim() || null,
            conversationToCompress: turns,
          }, null, 2),
        },
      ],
      temperature: chatTemperature(config, normalizeTemperature(config.compactTemperature, 0.1)),
    }),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`压缩模型返回 HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const payload = raw ? JSON.parse(raw) : {};
  const summary = summaryResponseText(payload);
  if (!summary) throw new Error("压缩模型返回了空摘要，已保留原上下文。");
  return { summary: summary.slice(0, maxSummaryChars), usage: payload.usage || null };
}

function summaryBatches(messages, tokenLimit) {
  const pieces = [];
  for (const message of messages) {
    if (estimateMessagesTokens([message]) <= tokenLimit || typeof message?.content !== "string") {
      pieces.push(message);
      continue;
    }
    const chunkSize = Math.max(500, Math.floor(tokenLimit * 0.75));
    const count = Math.ceil(message.content.length / chunkSize);
    for (let index = 0; index < count; index += 1) {
      pieces.push({
        ...message,
        content: `[原消息分段 ${index + 1}/${count}]\n${message.content.slice(index * chunkSize, (index + 1) * chunkSize)}`,
      });
    }
  }

  const batches = [];
  let batch = [];
  let tokens = 0;
  for (const piece of pieces) {
    const pieceTokens = estimateMessagesTokens([piece]);
    if (batch.length && tokens + pieceTokens > tokenLimit) {
      batches.push(batch);
      batch = [];
      tokens = 0;
    }
    batch.push(piece);
    tokens += pieceTokens;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

async function compactConversationContext(config, conversation, {
  force = false,
  reason = "automatic",
  runtimeMessages = [],
  onStart,
  signal,
} = {}) {
  throwIfAgentAborted(signal);
  const tools = safeToolSchemas();
  const budget = contextBudget(config.contextLength);
  const beforeTokens = estimateMessagesTokens(buildAgentMessages(config, conversation, runtimeMessages), tools);
  conversation.contextState = {
    ...normalizeContextState(conversation.contextState),
    estimatedTokens: beforeTokens,
    contextLength: budget.limit,
  };

  if (!force && (!budget.limit || beforeTokens <= budget.triggerTokens)) {
    return { changed: false, reason: budget.limit ? "below_threshold" : "context_length_unset", beforeTokens, afterTokens: beforeTokens, usage: null };
  }

  const { rounds } = splitIntoRounds(conversation.turns);
  if (rounds.length <= 1) {
    return { changed: false, reason: "insufficient_history", beforeTokens, afterTokens: beforeTokens, usage: null };
  }

  const turnTokens = estimateMessagesTokens(flattenRounds(rounds));
  let { older, recent } = splitRecentRounds(rounds, turnTokens, contextDefaults.keepRecentRatio);
  const fixedTokens = estimateMessagesTokens([
    { role: "system", content: buildAgentSystemPrompt(config.customInstructions) },
    ...runtimeMessages,
  ], tools);
  if (budget.targetTokens && fixedTokens + estimateMessagesTokens(flattenRounds(recent)) > budget.targetTokens) {
    older = [...older, ...recent];
    recent = [];
  }
  if (!older.length) {
    return { changed: false, reason: "insufficient_history", beforeTokens, afterTokens: beforeTokens, usage: null };
  }

  onStart?.({ beforeTokens, reason });
  const summaryInputLimit = budget.limit ? Math.max(1000, Math.floor(budget.limit * 0.45)) : 64000;
  const maxSummaryChars = budget.limit ? Math.min(8000, Math.max(1200, Math.floor(budget.limit * 0.08))) : 6000;
  let nextSummary = conversation.contextState.summary;
  let usage = null;
  for (const batch of summaryBatches(flattenRounds(older), summaryInputLimit)) {
    throwIfAgentAborted(signal);
    const generated = await requestContextSummary(config, nextSummary, batch, maxSummaryChars, signal);
    nextSummary = generated.summary;
    usage = generated.usage || usage;
  }

  conversation.turns = flattenRounds(recent);
  const compactedAt = nowIso();
  conversation.contextState = {
    ...conversation.contextState,
    summary: nextSummary,
    compactionCount: conversation.contextState.compactionCount + 1,
    lastCompactedAt: compactedAt,
    lastCompactionReason: reason,
    lastBeforeTokens: beforeTokens,
  };
  const afterTokens = estimateMessagesTokens(buildAgentMessages(config, conversation, runtimeMessages), tools);
  conversation.contextState.lastAfterTokens = afterTokens;
  conversation.contextState.estimatedTokens = afterTokens;
  conversation.contextState.lastPromptTokens = afterTokens;
  conversation.updatedAt = compactedAt;
  return {
    changed: true,
    reason,
    summary: nextSummary,
    beforeTokens,
    afterTokens,
    usage,
    stillOverBudget: Boolean(budget.limit && afterTokens > budget.triggerTokens),
  };
}

async function runAgent({ text, attachments, conversationId, userMessageId, assistantMessageId } = {}, { emitProgress, signal } = {}) {
  const config = await readModelConfigInternal();
  const typedPrompt = String(text || "").trim();
  const images = await loadWorkspaceImages(attachments);
  if (!typedPrompt && !images.length) throw new Error("消息不能为空。");
  const prompt = [typedPrompt, agentImageReferenceText(images)].filter(Boolean).join("\n\n");
  const displayText = agentUserDisplayText(typedPrompt, images);
  let historyUserContent = prompt;

  const { state, conversation } = await getActiveConversation(conversationId);
  const steps = [];
  const userId = String(userMessageId || safeId());
  const assistantId = String(assistantMessageId || safeId());
  const startedAt = nowIso();
  const assistantMessage = {
    id: assistantId,
    role: "assistant",
    text: "",
    at: startedAt,
    steps,
    isRunning: true,
    status: "running",
  };
  conversation.messages = conversation.messages.filter((message) => message.id !== userId && message.id !== assistantId);
  conversation.messages.push(
    {
      id: userId,
      role: "user",
      text: displayText,
      attachments: images.map(({ fileName, relativePath, mimeType, sizeBytes }) => ({ fileName, relativePath, mimeType, sizeBytes })),
      at: startedAt,
      steps: [],
      status: "completed",
    },
    assistantMessage,
  );
  if (conversation.title === "新对话") conversation.title = (typedPrompt || images[0]?.fileName || "新对话").slice(0, 28);
  conversation.updatedAt = startedAt;
  state.activeId = conversation.id;
  await saveConversationState(state);

  const pushStep = (kind, title, detail = "") => {
    const step = { kind, title, detail, at: nowIso() };
    steps.push(step);
    emitProgress?.({
      type: "agent-step",
      conversationId: conversation.id,
      messageId: assistantId,
      step,
      steps,
    });
  };
  const finishTurn = async (content, status) => {
    assistantMessage.text = content;
    assistantMessage.at = nowIso();
    assistantMessage.steps = [...steps];
    assistantMessage.isRunning = false;
    assistantMessage.status = status;
    conversation.turns.push({ role: "user", content: historyUserContent }, { role: "assistant", content });
    conversation.updatedAt = nowIso();
    conversationContextInfo(conversation, config);
    state.activeId = conversation.id;
    await saveConversationState(state);
    return {
      message: content,
      messageId: assistantId,
      steps,
      usage,
      canceled: status === "canceled",
      conversation: conversationSummary(conversation, config),
    };
  };
  let usage = null;

  try {
    throwIfAgentAborted(signal);
    if (!config.apiKey || !config.baseUrl || !config.modelName) {
      return finishTurn("还没有配置大模型。请先到“设置”填写 API Key、调用链接和模型名称。", "completed");
    }

    let runtimeMessages;
    if (images.length && config.modelRoles?.image_caption?.enabled === true) {
      pushStep("vision", "正在转述附带图片", `${images.length} 张图片`);
      const visualAnalysis = await describeLoadedImages(config, images, signal);
      historyUserContent = `${prompt}\n\n图片转述结果：\n${visualAnalysis.text}`;
      runtimeMessages = [{ role: "user", content: historyUserContent }];
      pushStep("vision", "附带图片转述完成", `${images.length} 张图片`);
    } else if (images.length) {
      runtimeMessages = [{ role: "user", content: agentMultimodalContent(prompt, images) }];
      pushStep("vision", "附带图片将由主模型直接读取", `${images.length} 张图片`);
    } else {
      runtimeMessages = [{ role: "user", content: prompt }];
    }
    const contextRuntimeMessages = [{ role: "user", content: historyUserContent }];
    const maxToolRounds = Math.max(1, Number.parseInt(config.maxToolRounds || 6, 10));
    let autoCompressionFailed = false;
    let emergencyCompressionUsed = false;

    for (let index = 0; index < maxToolRounds; index += 1) {
      throwIfAgentAborted(signal);
      if (!autoCompressionFailed) {
        try {
          const compression = await compactConversationContext(config, conversation, {
            reason: index === 0 ? "before_request" : "before_tool_round",
            runtimeMessages: contextRuntimeMessages,
            signal,
            onStart: ({ beforeTokens }) => pushStep("context", "正在自动压缩上下文", `当前约 ${beforeTokens} tokens`),
          });
          if (compression.changed) {
            pushStep("context", "已自动压缩上下文", `${compression.beforeTokens} -> ${compression.afterTokens} tokens`);
            state.activeId = conversation.id;
            await saveConversationState(state);
          }
        } catch (error) {
          if (isAgentAbort(error, signal)) throw error;
          autoCompressionFailed = true;
          pushStep("context", "自动压缩失败，保留原上下文", String(error?.message || error));
        }
      }

      let messages = buildAgentMessages(config, conversation, runtimeMessages);
      pushStep("llm", `第 ${index + 1} 轮请求模型`);
      let response = await fetch(deriveChatUrl(config.baseUrl), {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.modelName,
          messages,
          tools: safeToolSchemas(),
          tool_choice: "auto",
          temperature: chatTemperature(config, normalizeTemperature(config.chatTemperature, 0.2)),
        }),
      });
      let raw = await response.text();
      throwIfAgentAborted(signal);
      if (!response.ok && !emergencyCompressionUsed && isContextLimitError(response.status, raw)) {
        emergencyCompressionUsed = true;
        const compression = await compactConversationContext(config, conversation, {
          force: true,
          reason: "context_limit_retry",
          runtimeMessages: contextRuntimeMessages,
          signal,
          onStart: ({ beforeTokens }) => pushStep("context", "模型上下文超限，正在紧急压缩", `当前约 ${beforeTokens} tokens`),
        });
        if (compression.changed) {
          pushStep("context", "紧急压缩完成，重试模型请求", `${compression.beforeTokens} -> ${compression.afterTokens} tokens`);
          state.activeId = conversation.id;
          await saveConversationState(state);
          messages = buildAgentMessages(config, conversation, runtimeMessages);
          response = await fetch(deriveChatUrl(config.baseUrl), {
            method: "POST",
            signal,
            headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: config.modelName,
              messages,
              tools: safeToolSchemas(),
              tool_choice: "auto",
              temperature: chatTemperature(config, normalizeTemperature(config.chatTemperature, 0.2)),
            }),
          });
          raw = await response.text();
          throwIfAgentAborted(signal);
        }
      }
      if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}: ${raw.slice(0, 1200)}`);
      const payload = raw ? JSON.parse(raw) : {};
      usage = payload.usage || usage;
      conversation.contextState = {
        ...normalizeContextState(conversation.contextState),
        lastPromptTokens: usagePromptTokens(payload.usage) || conversation.contextState?.lastPromptTokens || 0,
        contextLength: Math.max(0, Number.parseInt(config.contextLength, 10) || 0),
      };
      const message = payload?.choices?.[0]?.message || {};
      const toolCalls = message.tool_calls || [];

      if (!toolCalls.length) {
        const content = typeof message.content === "string" ? message.content : "执行完成。";
        pushStep("done", "模型已生成最终回答");
        return finishTurn(content, "completed");
      }

      runtimeMessages.push({ role: "assistant", content: message.content || "", tool_calls: toolCalls });
      for (const call of toolCalls) {
        throwIfAgentAborted(signal);
        const toolName = call?.function?.name;
        try {
          const args = JSON.parse(call?.function?.arguments || "{}");
          pushStep("tool", `调用工具 ${toolName}`, JSON.stringify(args, null, 2));
          const result = await callTool(toolName, args, { signal });
          pushStep("tool", `工具 ${toolName} 已完成`, JSON.stringify(result, null, 2).slice(0, 4000));
          runtimeMessages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        } catch (error) {
          if (isAgentAbort(error, signal)) throw error;
          const message = String(error?.message || error || "工具调用失败");
          pushStep("tool", `工具 ${toolName} 失败`, message);
          runtimeMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: { message } }),
          });
        }
      }
    }
    throw new Error(`模型连续请求工具超过 ${maxToolRounds} 轮，仍未给出最终回答。`);
  } catch (error) {
    const canceled = isAgentAbort(error, signal);
    const message = canceled ? "已停止生成。" : `执行失败：${String(error?.message || error).slice(0, 2000)}`;
    pushStep(canceled ? "canceled" : "error", canceled ? "用户已停止生成" : "执行失败", canceled ? "" : String(error?.message || error));
    const result = await finishTurn(message, canceled ? "canceled" : "failed");
    if (canceled) return result;
    throw error;
  }
}

async function compactAgentContext(conversationId) {
  const config = await readModelConfigInternal();
  if (!config.apiKey || !config.baseUrl || !config.modelName) throw new Error("还没有配置大模型，无法压缩上下文。");
  const { state, conversation } = await getActiveConversation(conversationId);
  if (!conversation.turns.length) return { ok: true, changed: false, summary: "当前没有需要压缩的历史对话。", keptTurns: 0, previousTurns: 0, usage: null };
  const previousTurns = conversation.turns.length;
  const compression = await compactConversationContext(config, conversation, { force: true, reason: "manual" });
  if (!compression.changed) {
    return {
      ok: true,
      changed: false,
      summary: "近期上下文较少，暂时没有可压缩的旧对话。",
      keptTurns: conversation.turns.length,
      previousTurns,
      usage: null,
      context: conversationContextInfo(conversation, config),
      conversation: conversationSummary(conversation, config),
    };
  }
  state.activeId = conversation.id;
  await saveConversationState(state);
  return {
    ok: true,
    changed: true,
    summary: compression.summary,
    keptTurns: conversation.turns.length,
    previousTurns,
    beforeTokens: compression.beforeTokens,
    afterTokens: compression.afterTokens,
    usage: compression.usage,
    context: conversationContextInfo(conversation, config),
    conversation: conversationSummary(conversation, config),
  };
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
      buffer = typeof entry?.base64 === "string"
        ? Buffer.from(entry.base64, "base64")
        : Buffer.from(entry?.bytes || []);
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

async function getLocalImageDataUrl(filePath) {
  const resolved = path.resolve(String(filePath || ""));
  const extension = path.extname(resolved).toLowerCase();
  const mimeType = IMAGE_MIME_BY_EXTENSION.get(extension);
  if (!mimeType) throw new Error("This file type is not supported for image preview.");
  const fileStat = await fs.stat(resolved);
  if (!fileStat.isFile()) throw new Error("Image preview target is not a file.");
  if (fileStat.size > MAX_INLINE_IMAGE_BYTES) throw new Error("Image is too large to preview inline.");
  const buffer = await fs.readFile(resolved);
  return { fileName: path.basename(resolved), path: resolved, mimeType, sizeBytes: buffer.byteLength, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}` };
}

async function getWorkspaceImageDataUrl(filePath) {
  return getLocalImageDataUrl(assertWorkspacePath(filePath));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function buildDocxPreviewHtml({ fileName, path: filePath, bodyHtml, messages }) {
  const warnings = Array.isArray(messages)
    ? messages
        .map((message) => message?.message || String(message || ""))
        .filter(Boolean)
    : [];
  const warningHtml = warnings.length
    ? `<section class="warnings"><strong>转换提示</strong>${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</section>`
    : "";

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fileName)}</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif;
      background: Canvas;
      color: CanvasText;
    }
    body {
      margin: 0;
      padding: 28px;
      line-height: 1.65;
      overflow-wrap: anywhere;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 22px;
      padding-bottom: 14px;
      border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
    }
    h1 {
      margin: 0 0 8px;
      font-size: 20px;
      line-height: 1.35;
    }
    .path {
      margin: 0;
      color: color-mix(in srgb, CanvasText 62%, transparent);
      font-size: 12px;
    }
    .warnings {
      margin: 0 0 18px;
      padding: 12px 14px;
      border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
      border-radius: 8px;
      background: color-mix(in srgb, CanvasText 5%, transparent);
    }
    .warnings p {
      margin: 6px 0 0;
      color: color-mix(in srgb, CanvasText 72%, transparent);
      font-size: 13px;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 14px 0;
    }
    td, th {
      border: 1px solid color-mix(in srgb, CanvasText 22%, transparent);
      padding: 6px 8px;
      vertical-align: top;
    }
    p {
      margin: 0 0 10px;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(fileName)}</h1>
      <p class="path">${escapeHtml(filePath)}</p>
    </header>
    ${warningHtml}
    <article>${bodyHtml || "<p>文档没有可预览内容。</p>"}</article>
  </main>
</body>
</html>`;
}

async function getWorkspaceDocxPreview(filePath) {
  const resolved = assertWorkspacePath(filePath);
  const extension = path.extname(resolved).toLowerCase();
  if (extension !== ".docx") throw new Error("Only .docx files can be converted for preview.");
  const fileStat = await fs.stat(resolved);
  if (!fileStat.isFile()) throw new Error("DOCX preview target is not a file.");

  const buffer = await fs.readFile(resolved);
  const mammothModule = await import("mammoth");
  const mammoth = mammothModule.default || mammothModule;
  const result = await mammoth.convertToHtml({ buffer });
  const fileName = path.basename(resolved);

  return {
    fileName,
    path: resolved,
    extension,
    sizeBytes: fileStat.size,
    converter: "mammoth",
    messages: result.messages || [],
    html: buildDocxPreviewHtml({
      fileName,
      path: resolved,
      bodyHtml: result.value || "",
      messages: result.messages || [],
    }),
  };
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
    return JSON.parse(await fs.readFile(path.join(repoRoot, "apps", "legacy", "electron", "package.json"), "utf8")).version || "0.0.0";
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

async function handleRequest(request, emitProgress) {
  const method = String(request?.method || "");
  const params = request?.params && typeof request.params === "object" ? request.params : {};
  if (method === "app.info" || method === "app:info") return appInfo();
  if (method === "app.openPath" || method === "app:open-path") return openAppPath(params.key || params.path || "workspaceDir");
  if (method === "session.loginWithCredentials" || method === "session:login") {
    await ensurePlaywrightBrowsers();
    return client.loginWithCredentials({
      username: String(params.username || ""),
      password: String(params.password || ""),
      headless: true,
      timeoutMs: Number(params.timeoutMs || 60000),
      agreeTerms: params.agreeTerms !== false,
    });
  }
  if (method === "tool.call" || method === "bxb:tool") return callTool(String(params.name || ""), params.args || {});
  if (method === "session.status" || method === "bxb:session") return callTool("session_status", {});
  if (method === "modelConfig.load" || method === "config:model:load") return loadModelConfig();
  if (method === "modelConfig.save" || method === "config:model:save") return saveModelConfig(params.config || params);
  if (method === "modelConfig.providerCreate" || method === "config:model:provider:create") return createModelProvider(params.config || params);
  if (method === "modelConfig.providerDelete" || method === "config:model:provider:delete") return deleteModelProvider(params.config || params);
  if (method === "modelConfig.providerSelect" || method === "config:model:provider:select") return saveModelConfig({ activeProviderId: params.providerId || params.activeProviderId, modelRole: params.modelRole || params.role });
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
  if (method === "agent.chat" || method === "agent:chat") {
    const runId = String(params.assistantMessageId || safeId());
    const controller = new AbortController();
    const run = {
      runId,
      conversationId: String(params.conversationId || ""),
      assistantMessageId: String(params.assistantMessageId || ""),
      controller,
    };
    activeAgentRuns.set(runId, run);
    try {
      return await withConversationLock(params.conversationId, () => runAgent(params, { emitProgress, signal: controller.signal }));
    } finally {
      if (activeAgentRuns.get(runId) === run) activeAgentRuns.delete(runId);
    }
  }
  if (method === "agent.cancel" || method === "agent:cancel") {
    const assistantMessageId = String(params.assistantMessageId || "");
    const conversationId = String(params.conversationId || "");
    const matches = [...activeAgentRuns.values()].filter((run) => (
      (assistantMessageId && run.assistantMessageId === assistantMessageId)
      || (!assistantMessageId && conversationId && run.conversationId === conversationId)
    ));
    for (const run of matches) run.controller.abort();
    return { ok: true, cancellationRequested: matches.length > 0, canceledRuns: matches.length };
  }
  if (method === "agent.compact" || method === "agent:compact") {
    return withConversationLock(params.conversationId, () => compactAgentContext(params.conversationId));
  }
  if (method === "agent.reset" || method === "agent:reset") {
    const { state, conversation } = await getActiveConversation(params.conversationId);
    conversation.messages = [];
    conversation.turns = [];
    conversation.contextState = normalizeContextState();
    conversation.updatedAt = nowIso();
    await saveConversationState(state);
    return { ok: true };
  }
  if (method === "workspace.importPaths" || method === "workspace:import") return importWorkspacePaths(params.paths || []);
  if (method === "workspace.savePastes" || method === "workspace:save-pastes") return saveWorkspacePastes(params.items);
  if (method === "workspace.open" || method === "workspace:open") return openAppPath("workspaceDir");
  if (method === "workspace.imageDataUrl" || method === "workspace:image-data-url") return getWorkspaceImageDataUrl(params.filePath);
  if (method === "workspace.docxPreview" || method === "workspace:docx-preview") return getWorkspaceDocxPreview(params.filePath);
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
    const emitProgress = (result) => writeResponse({ id: request.id ?? null, method: request.method ?? "", event: "progress", result });
    const result = await handleRequest(request, emitProgress);
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
