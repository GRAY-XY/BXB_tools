const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");

let mainWindow = null;
let clientPromise = null;

async function getClient() {
  if (clientPromise) {
    return clientPromise;
  }

  clientPromise = (async () => {
    const { BanxuebangClient } = await import("../src/banxuebang-client.js");
    const { SessionStore } = await import("../src/session-store.js");
    const sessionFile = path.join(app.getPath("userData"), "banxuebang-session.json");
    return new BanxuebangClient(new SessionStore(sessionFile));
  })();

  return clientPromise;
}

function createWindow() {
  const isMac = process.platform === "darwin";
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    frame: !isMac ? false : true,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    backgroundColor: "#cfd8e5",
    vibrancy: isMac ? "sidebar" : undefined,
    visualEffectState: isMac ? "active" : undefined,
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("maximize", () => {
    mainWindow?.webContents.send("window-state", { maximized: true });
  });

  mainWindow.on("unmaximize", () => {
    mainWindow?.webContents.send("window-state", { maximized: false });
  });
}

async function buildDashboardPayload() {
  const api = await getClient();
  const session = await api.getSession();
  const summary = api.summarizeSession(session);

  if (!summary.ready) {
    return {
      session: summary,
      terms: [],
      courses: [],
      homework: [],
      pendingHomework: [],
      schedule: {},
      timeSlots: {},
      notices: [],
      unreadCount: null,
      gpa: null,
      currentTask: null,
    };
  }

  const [termsResult, coursesResult, homeworkResult, pendingResult, gpaResult, scheduleResult, noticesResult, unreadResult] = await Promise.all([
    api.listTerms().catch(() => ({ terms: [] })),
    api.listCourses().catch(() => ({ courses: [] })),
    api.listTasks({ listType: "all", page: 1, size: 24 }).catch(() => ({
      homeworkList: [],
      unsubmittedHomeworkList: [],
    })),
    api.listTasks({ listType: "pending", page: 1, size: 12 }).catch(() => ({
      homeworkList: [],
    })),
    api.getCurrentSubjectGpa().catch(() => null),
    api.getSchedule().catch(() => ({ schedule: {}, timeSlots: {} })),
    api.getNotices({ page: 1, size: 20 }).catch(() => ({ notices: [] })),
    api.getUndoMessageCount().catch(() => ({ count: null })),
  ]);

  return {
    session: summary,
    terms: termsResult.terms || [],
    courses: coursesResult.courses || [],
    homework: homeworkResult.homeworkList || [],
    pendingHomework: pendingResult.homeworkList || homeworkResult.unsubmittedHomeworkList || [],
    schedule: scheduleResult.schedule || {},
    timeSlots: scheduleResult.timeSlots || {},
    notices: noticesResult.notices || [],
    unreadCount: unreadResult.count || null,
    gpa: gpaResult,
    currentTask: null,
  };
}

async function withErrorBoundary(work) {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("dashboard:load", () => withErrorBoundary(buildDashboardPayload));
  ipcMain.handle("session:login", () =>
    withErrorBoundary(async () => {
      const api = await getClient();
      await api.interactiveLogin({ headless: false, timeoutMs: 300000 });
      return buildDashboardPayload();
    }),
  );
  ipcMain.handle("session:logout", () =>
    withErrorBoundary(async () => {
      const api = await getClient();
      await api.clearSession();
      return buildDashboardPayload();
    }),
  );
  ipcMain.handle("subject:set", (_event, subjectName) =>
    withErrorBoundary(async () => {
      const api = await getClient();
      await api.setCurrentSubjectByName(subjectName);
      return buildDashboardPayload();
    }),
  );
  ipcMain.handle("task:open", (_event, taskId) =>
    withErrorBoundary(async () => {
      const api = await getClient();
      return api.getTaskDetail(taskId, { includeOtherSubmissions: false });
    }),
  );
  ipcMain.handle("task:submit", (_event, payload) =>
    withErrorBoundary(async () => {
      const api = await getClient();
      return api.submitTaskResult(payload || {});
    }),
  );
  ipcMain.handle("files:pick", async () => {
    if (!mainWindow) {
      return { canceled: true, filePaths: [] };
    }
    return dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
    });
  });
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:is-maximized", () => (mainWindow ? mainWindow.isMaximized() : false));
  ipcMain.handle("shell:open-external", (_event, url) => shell.openExternal(url));

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
