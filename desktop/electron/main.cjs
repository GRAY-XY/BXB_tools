const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const isDev = !app.isPackaged;
const repoRoot = path.resolve(__dirname, "..", "..");
const payloadRoot = isDev ? repoRoot : path.join(process.resourcesPath, "payload");
const userDataRoot = app.getPath("userData");
const dataRoot = path.join(userDataRoot, ".banxuebang");
const workspaceDir = path.join(dataRoot, "workspace");
const modelConfigPath = path.join(userDataRoot, "model-config.json");
const conversationsPath = path.join(userDataRoot, "agent-conversations.json");
const DEFAULT_SYSTEM_PROMPT =
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。用户提到工作区文件时，先调用 list_workspace_files 定位文件，再按需调用 read_workspace_file；需要整理文件名时可调用 rename_workspace_file。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。";
const LEGACY_DEFAULT_SYSTEM_PROMPTS = new Set([
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。",
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。需要联网资料时先调用 web_search；需要阅读某个搜索结果时再调用 read_web_page。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。",
]);

let mainWindow = null;
let toolRuntimePromise = null;
let conversationStatePromise = null;

function safeError(error) {
  return {
    message: error?.message || String(error),
    stack: error?.stack || "",
  };
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
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "ms-playwright"));
  }
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, "AppData", "Local", "ms-playwright"));
  }
  return [...new Set(candidates.filter(Boolean).map((item) => path.resolve(item)))];
}

function hasChromiumCache(browserRoot) {
  const chromiumRoot = path.join(browserRoot, "chromium-1217");
  return (
    existsSync(path.join(chromiumRoot, "chrome-win64", "chrome.exe")) ||
    existsSync(path.join(chromiumRoot, "chrome-win", "chrome.exe"))
  );
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
    process.env.BANXUEBANG_DRAFT_DIR = path.join(dataRoot, "drafts");
    process.env.BANXUEBANG_WORKSPACE_DIR = workspaceDir;

    const srcRoot = path.join(payloadRoot, "src");
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
  const { toolDefinitions, executeTool } = await getToolRuntime();
  return executeTool(toolDefinitions, name, args || {});
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

async function loadModelConfig() {
  const config = await readJson(modelConfigPath, {
    apiKey: "",
    baseUrl: "",
    modelName: "",
    contextLength: 0,
    maxToolRounds: 6,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    ...config,
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
      description: "保存 AI 写好的提交草稿，等待用户审核；不会上传或提交。",
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
        temperature: 0.2,
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
      temperature: 0.1,
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
  userDataRoot,
  dataRoot,
  workspaceDir,
  payloadRoot,
  browserDependency: getBrowserDependencyStatus(),
}));

ipcMain.handle("bxb:session", async () => callTool("session_status"));
ipcMain.handle("bxb:tool", async (_event, { name, args }) => callTool(name, args));
ipcMain.handle("workspace:import", async () => importWorkspaceFiles());
ipcMain.handle("workspace:open", async () => {
  await fs.mkdir(workspaceDir, { recursive: true });
  await shell.openPath(workspaceDir);
  return { ok: true, workspaceDir };
});
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
