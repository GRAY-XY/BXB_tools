const { app, BrowserWindow, ipcMain } = require("electron");
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
const modelConfigPath = path.join(userDataRoot, "model-config.json");
const DEFAULT_SYSTEM_PROMPT =
  "你是伴学邦桌面助手。需要真实数据时必须调用工具，不要猜测。不要上传、提交或删除任何内容。处理作业草稿时先调用 collect_task_submission_context；信息不足就说明缺什么；信息足够才调用 draft_task_submission 保存草稿等待用户审核。";

let mainWindow = null;
let toolRuntimePromise = null;
let turns = [];

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
  return getBrowserDependencyStatus();
}

async function getToolRuntime() {
  if (toolRuntimePromise) {
    return toolRuntimePromise;
  }

  toolRuntimePromise = (async () => {
    await fs.mkdir(dataRoot, { recursive: true });
    process.env.BANXUEBANG_SESSION_FILE = path.join(dataRoot, "session.json");
    process.env.BANXUEBANG_DRAFT_DIR = path.join(dataRoot, "drafts");

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
  if (["interactive_login", "login_in_browser", "login_with_credentials", "browser_capture_achievement_page"].includes(name)) {
    await ensurePlaywrightBrowsers();
  }
  const { toolDefinitions, executeTool } = await getToolRuntime();
  return executeTool(toolDefinitions, name, args || {});
}

async function loadModelConfig() {
  const config = await readJson(modelConfigPath, {
    apiKey: "",
    baseUrl: "",
    modelName: "",
    contextLength: 0,
    maxToolRounds: 6,
    maxMemoryTurns: 6,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  });
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    ...config,
    systemPrompt: String(config.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT,
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
    maxMemoryTurns: Math.max(1, Number.parseInt(config?.maxMemoryTurns || 6, 10) || 6),
    systemPrompt: String(config?.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT,
  };
  await writeJson(modelConfigPath, normalized);
  return loadModelConfig();
}

async function testModelConfig(config) {
  const candidate = await saveModelConfig(config);
  if (!candidate.apiKey || !candidate.baseUrl || !candidate.modelName) {
    throw new Error("请先填写 API Key、调用链接和模型名称。");
  }

  const response = await fetch(deriveModelsUrl(candidate.baseUrl), {
    headers: {
      Authorization: `Bearer ${candidate.apiKey}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`模型服务返回 HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  const payload = text ? JSON.parse(text) : {};
  const models = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  const modelIds = models.map((item) => String(item?.id || "")).filter(Boolean);
  return {
    ok: modelIds.includes(candidate.modelName),
    modelsUrl: deriveModelsUrl(candidate.baseUrl),
    modelName: candidate.modelName,
    modelsCount: modelIds.length,
    sampleModels: modelIds.slice(0, 20),
    message: modelIds.includes(candidate.modelName)
      ? `连接成功，已找到模型 ${candidate.modelName}。`
      : `连接成功，但模型列表里没有找到 ${candidate.modelName}。`,
  };
}

function toolSchemas() {
  return [
    { name: "session_status", description: "读取当前伴学邦登录状态和上下文。", parameters: { type: "object", properties: {} } },
    { name: "login_in_browser", description: "打开浏览器让用户手动登录伴学邦。", parameters: { type: "object", properties: {} } },
    { name: "list_terms", description: "列出可用学期。", parameters: { type: "object", properties: {} } },
    {
      name: "set_current_term",
      description: "按学期名或 id 切换当前学期。",
      parameters: { type: "object", properties: { term_name: { type: "string" }, term_id: { type: "string" } } },
    },
    { name: "list_courses", description: "列出当前学期课程。", parameters: { type: "object", properties: {} } },
    {
      name: "set_current_subject",
      description: "按课程名称或 id 切换当前课程。",
      parameters: {
        type: "object",
        properties: { subject_name: { type: "string" }, subject_id: { type: "string" }, class_id: { type: "string" } },
      },
    },
    {
      name: "list_tasks",
      description: "列出作业任务，可指定课程/学期和 pending/all/latest。",
      parameters: {
        type: "object",
        properties: {
          term_name: { type: "string" },
          subject_name: { type: "string" },
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

async function runAgent({ text, requestId }) {
  const config = await loadModelConfig();
  if (!config.apiKey || !config.baseUrl || !config.modelName) {
    return {
      message: "还没有配置大模型。请先到“模型”页面填写 API Key、调用链接和模型名称。",
      steps: [],
      usage: null,
    };
  }

  const steps = [];
  const pushStep = (kind, title, detail = "") => {
    const step = { kind, title, detail, at: new Date().toISOString() };
    steps.push(step);
    if (mainWindow && requestId) {
      mainWindow.webContents.send("agent:progress", { requestId, step });
    }
  };

  const maxMemoryTurns = Math.max(1, Number.parseInt(config.maxMemoryTurns || 6, 10));
  const maxToolRounds = Math.max(1, Number.parseInt(config.maxToolRounds || 6, 10));
  const messages = [
    {
      role: "system",
      content: String(config.systemPrompt || "").trim() || DEFAULT_SYSTEM_PROMPT,
    },
    ...turns.slice(-(maxMemoryTurns * 2)),
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
      turns.push({ role: "user", content: text }, { role: "assistant", content });
      turns = turns.slice(-(maxMemoryTurns * 2));
      pushStep("done", "模型已生成最终回答");
      return { message: content, steps, usage };
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
  payloadRoot,
  browserDependency: getBrowserDependencyStatus(),
}));

ipcMain.handle("bxb:session", async () => callTool("session_status"));
ipcMain.handle("bxb:tool", async (_event, { name, args }) => callTool(name, args));
ipcMain.handle("config:model:load", async () => loadModelConfig());
ipcMain.handle("config:model:save", async (_event, config) => saveModelConfig(config));
ipcMain.handle("config:model:clear", async () => {
  await fs.rm(modelConfigPath, { force: true });
  return loadModelConfig();
});
ipcMain.handle("config:model:test", async (_event, config) => testModelConfig(config));
ipcMain.handle("agent:chat", async (_event, payload) => runAgent(payload));
ipcMain.handle("agent:reset", async () => {
  turns = [];
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
