const state = {
  dashboard: null,
  activeView: "overview",
  selectedCourseId: "all",
  selectedTaskId: null,
  homeworkSort: "latest",
  selectedTaskDetail: null,
  selectedSubmitFiles: [],
  theme: "light",
  bridgeReady: false,
  settings: {
    homeworkReminderEnabled: true,
    homeworkAbsoluteTime: "20:00",
    homeworkReminderDays: [1, 2, 3, 4, 5],
    homeworkReminderContent: "medium",
    classReminderEnabled: false,
    classReminderLeadTime: "10",
    motionEnabled: true,
    frostEnabled: true,
    accentColor: "#1f6feb",
    backgroundImagePath: "",
    backgroundOpacity: 28,
  },
  authMemory: {
    rememberPassword: false,
    username: "",
    password: "",
  },
  appMeta: null,
  updateInfo: null,
  access: null,
  registry: null,
};

if (navigator.userAgent.includes("Mac OS X")) {
  document.body.classList.add("darwin");
} else if (navigator.userAgent.includes("Windows")) {
  document.body.classList.add("windows");
}

function createMockDashboard() {
  const terms = [
    { id: "term-3", name: "2026-2027上学期", status: false },
    { id: "term-2", name: "2025-2026下学期", status: true },
    { id: "term-1", name: "2025-2026上学期", status: false },
  ];
  return {
    session: {
      ready: true,
      user: { name: "周田园", loginName: "igpig@example.com" },
      currentClass: { name: "高二6班", alias: "G12 AP3" },
      currentTermId: "term-2",
      currentSubject: { id: "stats", name: "AP统计学" },
      availableTerms: terms,
    },
    terms,
    courses: [
      { id: "citizen", name: "国际公民素养", unSubmitCount: 2 },
      { id: "stats", name: "AP统计学", unSubmitCount: 1 },
      { id: "env", name: "AP环境科学", unSubmitCount: 0 },
      { id: "ai", name: "人工智能发展", unSubmitCount: 1 },
    ],
    homework: [
      {
        id: "t1",
        courseId: "stats",
        courseName: "AP统计学",
        activityName: "Chapter 9 worksheet",
        scoreTypeName: "作业",
        endTime: "2026-04-27 23:59:00",
        scoreLevel: "E+",
        na: 1,
      },
      {
        id: "t2",
        courseId: "ai",
        courseName: "人工智能发展",
        activityName: "Research summary",
        scoreTypeName: "项目",
        endTime: "2026-04-28 19:00:00",
      },
    ],
    pendingHomework: [
      {
        id: "t1",
        courseId: "stats",
        courseName: "AP统计学",
        activityName: "Chapter 9 worksheet",
        scoreTypeName: "作业",
        endTime: "2026-04-27 23:59:00",
        scoreLevel: "E+",
        na: 1,
      },
    ],
    schedule: {
      1: {
        0: { time: "08:00-08:40", courses: [{ name: "AP环境科学", teacher: "李娟", room: "505" }] },
        1: { time: "08:50-09:30", courses: [{ name: "AP环境科学", teacher: "李娟", room: "505" }] },
        2: { time: "10:05-10:45", courses: [{ name: "AP统计学", teacher: "张其", room: "505" }] },
      },
      2: {
        5: { time: "14:30-15:10", courses: [{ name: "人工智能发展", teacher: "佟佳宁", room: "509" }] },
      },
    },
    timeSlots: {
      0: "08:00-08:40",
      1: "08:50-09:30",
      2: "10:05-10:45",
      3: "10:55-11:35",
      4: "11:40-12:10",
      5: "14:30-15:10",
      6: "15:20-16:00",
      7: "16:15-16:55",
      8: "17:05-17:45",
    },
    notices: [{ id: "n1", title: "Term Paper due", sender: "Saurav", time: "2026-01-09 11:19", content: "Remember to submit the term paper.", read: false }],
    unreadCount: { noticeNotReceipt: 1 },
    gpa: {
      averageLevel: "A+",
      achievementCount: 9,
      scoreLevelCount: 13,
      selectedTransferClass: { className: "AP G11 AP3 国际公民素养" },
    },
  };
}

function createPyWebViewBridge() {
  if (!(window.pywebview && window.pywebview.api)) {
    return null;
  }
  return {
    loadDashboard: () => window.pywebview.api.load_dashboard(),
    login: () => window.pywebview.api.login(),
    loginWithCredentials: (username, password) => window.pywebview.api.login_with_credentials(username, password),
    logout: () => window.pywebview.api.logout(),
    setTerm: (termId) => window.pywebview.api.set_term(termId),
    setSubject: (subjectName) => window.pywebview.api.set_subject(subjectName),
    openTask: (taskId) => window.pywebview.api.open_task(taskId),
    submitTask: (payload) => window.pywebview.api.submit_task(payload),
    downloadAttachment: (taskId, fileId) => window.pywebview.api.download_attachment(taskId, fileId),
    pickFiles: () => window.pywebview.api.pick_files(),
    pickBackgroundImage: () => window.pywebview.api.pick_background_image(),
    getAppMeta: () => window.pywebview.api.get_app_meta(),
    checkForUpdates: () => window.pywebview.api.check_for_updates(),
    revealPath: (targetPath) => window.pywebview.api.reveal_path(targetPath),
    openExternal: (url) => window.pywebview.api.open_external(url),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      onStateChange: () => () => {},
    },
  };
}

function isPreviewMode() {
  return location.protocol === "http:" || location.protocol === "https:";
}

const loggedOutDashboard = {
  session: { ready: false, sessionFile: "~/.banxuebang/session.json" },
  terms: [],
  courses: [],
  homework: [],
  pendingHomework: [],
  schedule: {},
  timeSlots: {},
  notices: [],
  unreadCount: null,
  gpa: null,
};

const mockBridge = {
  loadDashboard: async () => ({ ok: true, data: createMockDashboard() }),
  login: async () => ({ ok: true, data: createMockDashboard() }),
  loginWithCredentials: async () => ({ ok: true, data: createMockDashboard() }),
  logout: async () => ({ ok: true, data: loggedOutDashboard }),
  setTerm: async (termId) => {
    const dashboard = createMockDashboard();
    dashboard.session.currentTermId = termId;
    return { ok: true, data: dashboard };
  },
  setSubject: async () => ({ ok: true, data: createMockDashboard() }),
  openTask: async (taskId) => ({
    ok: true,
    data: {
      taskId,
      taskSummary: createMockDashboard().homework.find((task) => task.id === taskId),
      contentText: "这里会显示作业内容、老师说明和提交要求。",
      attachments: [],
      mySubmissionAttachments: [],
      mySubmissionList: [],
    },
  }),
  submitTask: async () => ({ ok: true, data: {} }),
  downloadAttachment: async (taskId, fileId) => ({
    ok: true,
    data: {
      taskId,
      fileId,
      fileName: "mock-attachment.pdf",
      path: "/mock/BXB Student/mock-attachment.pdf",
      uri: "file:///mock/BXB%20Student/mock-attachment.pdf",
    },
  }),
  pickFiles: async () => ({ canceled: false, filePaths: ["/mock/Homework.pdf"] }),
  pickBackgroundImage: async () => ({ canceled: false, filePath: "/mock/background.png" }),
  getAppMeta: async () => ({
    ok: true,
    data: {
      appName: "BXB Student",
      version: "1.0.2",
      platform: "Preview",
      downloadsDir: "/mock/Downloads/BXB Student",
      logsDir: "/mock/AppSupport/BXB Student/logs",
      releaseNotesPath: "/mock/docs/releases/1.0.2.md",
      agreementPath: "/mock/docs/legal/BXB_Student_User_Agreement_zh-CN.md",
      privacyPath: "/mock/docs/legal/BXB_Student_Privacy_Notice_zh-CN.md",
      releaseUrl: "https://github.com/GRAY-XY/BXB_tools/releases",
      githubUrl: "https://github.com/GRAY-XY/BXB_tools",
      email: "igpig1226@gmail.com",
    },
  }),
  checkForUpdates: async () => ({
    ok: true,
    data: {
      currentVersion: "1.0.2",
      latestVersion: "1.0.2",
      hasUpdate: false,
      releaseName: "BXB Student 1.0.2",
      releaseUrl: "https://github.com/GRAY-XY/BXB_tools/releases/tag/v1.0.2",
      publishedAt: "2026-05-18T00:00:00Z",
      body: "Current build",
    },
  }),
  revealPath: async () => true,
  openExternal: async () => {},
  window: {
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    onStateChange: () => () => {},
  },
};

let bridge = window.bxbApp || createPyWebViewBridge() || (isPreviewMode() ? mockBridge : null);

const els = {
  appShell: document.querySelector("#app-shell"),
  sidebarStatus: document.querySelector("#sidebar-status"),
  authBtn: document.querySelector("#auth-btn"),
  refreshBtn: document.querySelector("#refresh-btn"),
  loginStage: document.querySelector("#login-stage"),
  workspace: document.querySelector("#workspace"),
  loginUsername: document.querySelector("#login-username"),
  loginPassword: document.querySelector("#login-password"),
  rememberPassword: document.querySelector("#remember-password"),
  loginSubmitBtn: document.querySelector("#login-submit-btn"),
  pageTitle: document.querySelector("#page-title"),
  pageSubtitle: document.querySelector("#page-subtitle"),
  termSwitch: document.querySelector("#term-switch"),
  termSelect: document.querySelector("#term-select"),
  navItems: [...document.querySelectorAll(".nav-item")],
  views: [...document.querySelectorAll(".content-view")],
  studentName: document.querySelector("#student-name"),
  studentClass: document.querySelector("#student-class"),
  termPill: document.querySelector("#term-pill"),
  heroNote: document.querySelector("#hero-note"),
  pendingCount: document.querySelector("#pending-count"),
  riskCount: document.querySelector("#risk-count"),
  homeworkSummaryNotes: document.querySelector("#homework-summary-notes"),
  todayTimeline: document.querySelector("#today-timeline"),
  weeklySchedule: document.querySelector("#weekly-schedule"),
  homeworkSubjects: document.querySelector("#homework-subjects"),
  homeworkTaskList: document.querySelector("#homework-task-list"),
  homeworkSort: document.querySelector("#homework-sort"),
  detailTitle: document.querySelector("#detail-title"),
  detailMeta: document.querySelector("#detail-meta"),
  detailBody: document.querySelector("#detail-body"),
  detailAttachments: document.querySelector("#detail-attachments"),
  submitRemark: document.querySelector("#submit-remark"),
  pickFilesBtn: document.querySelector("#pick-files-btn"),
  pickedFiles: document.querySelector("#picked-files"),
  submitTaskBtn: document.querySelector("#submit-task-btn"),
  themeChips: [...document.querySelectorAll(".theme-chip")],
  homeworkReminderEnabled: document.querySelector("#setting-homework-reminder-enabled"),
  homeworkAbsoluteTime: document.querySelector("#setting-homework-absolute-time"),
  homeworkReminderDays: document.querySelector("#setting-homework-days"),
  homeworkReminderContent: document.querySelector("#setting-homework-reminder-content"),
  classReminderEnabled: document.querySelector("#setting-class-reminder-enabled"),
  classReminderLeadTime: document.querySelector("#setting-class-reminder-time"),
  motionEnabled: document.querySelector("#setting-motion-enabled"),
  frostEnabled: document.querySelector("#setting-frost-enabled"),
  accentColor: document.querySelector("#setting-accent-color"),
  accentColorValue: document.querySelector("#setting-accent-color-value"),
  backgroundOpacity: document.querySelector("#setting-background-opacity"),
  backgroundOpacityValue: document.querySelector("#setting-background-opacity-value"),
  pickBackgroundBtn: document.querySelector("#pick-background-btn"),
  clearBackgroundBtn: document.querySelector("#clear-background-btn"),
  backgroundPreview: document.querySelector("#background-preview"),
  minimizeBtn: document.querySelector("#minimize-btn"),
  maximizeBtn: document.querySelector("#maximize-btn"),
  closeBtn: document.querySelector("#close-btn"),
  contactLinks: [...document.querySelectorAll(".contact-link")],
  updateBtn: document.querySelector("#update-btn"),
  settingsCheckUpdateBtn: document.querySelector("#settings-check-update-btn"),
  openReleaseBtn: document.querySelector("#open-release-btn"),
  appVersionPill: document.querySelector("#app-version-pill"),
  aboutVersion: document.querySelector("#about-version"),
  aboutPlatform: document.querySelector("#about-platform"),
  aboutDownloadsPath: document.querySelector("#about-downloads-path"),
  aboutLogsPath: document.querySelector("#about-logs-path"),
  updateCard: document.querySelector("#update-card"),
  updateStatusTitle: document.querySelector("#update-status-title"),
  updateStatusCopy: document.querySelector("#update-status-copy"),
  openDownloadsBtn: document.querySelector("#open-downloads-btn"),
  openLogsBtn: document.querySelector("#open-logs-btn"),
  openAgreementBtn: document.querySelector("#open-agreement-btn"),
  openPrivacyBtn: document.querySelector("#open-privacy-btn"),
  openReleaseNotesBtn: document.querySelector("#open-release-notes-btn"),
  lockCard: document.querySelector("#lock-card"),
  lockMessage: document.querySelector("#lock-message"),
  aboutPolicyUrl: document.querySelector("#about-policy-url"),
  aboutRegistryStatus: document.querySelector("#about-registry-status"),
};

const viewMeta = {
  overview: {
    title: "主页",
    subtitle: "优先显示姓名、班级、未提交作业和今天课程。",
  },
  schedule: {
    title: "课表",
    subtitle: "只保留周一到周五的一周课表，快速查看整周安排。",
  },
  homework: {
    title: "作业",
    subtitle: "左侧按科目筛选，右侧查看内容、附件并直接提交。",
  },
  settings: {
    title: "设置",
    subtitle: "管理提醒开关、提醒内容和白天 / 黑夜外观。",
  },
};

function loadTheme() {
  const saved = localStorage.getItem("bxb-theme");
  state.theme = saved === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  for (const chip of els.themeChips) {
    chip.classList.toggle("is-active", chip.dataset.theme === state.theme);
  }
}

function loadSavedCredentials() {
  const raw = localStorage.getItem("bxb-auth-memory");
  if (raw) {
    try {
      state.authMemory = {
        ...state.authMemory,
        ...JSON.parse(raw),
      };
    } catch {}
  }

  els.rememberPassword.checked = Boolean(state.authMemory.rememberPassword);
  els.loginUsername.value = state.authMemory.username || "";
  els.loginPassword.value = state.authMemory.rememberPassword ? state.authMemory.password || "" : "";
}

function saveCredentials() {
  localStorage.setItem("bxb-auth-memory", JSON.stringify(state.authMemory));
}

function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  localStorage.setItem("bxb-theme", state.theme);
  document.documentElement.dataset.theme = state.theme;
  for (const chip of els.themeChips) {
    chip.classList.toggle("is-active", chip.dataset.theme === state.theme);
  }
  applyAppearanceSettings();
}

function hexToRgb(hex) {
  const normalized = String(hex || "").trim().replace("#", "");
  const value = normalized.length === 3
    ? normalized
        .split("")
        .map((char) => char + char)
        .join("")
    : normalized;
  const int = Number.parseInt(value, 16);
  if (Number.isNaN(int) || value.length !== 6) {
    return { r: 31, g: 111, b: 235 };
  }
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function rgbaString(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function pathToFileUrl(filePath) {
  if (!filePath) {
    return "";
  }
  const normalized = filePath.replace(/\\/g, "/");
  return encodeURI(`file://${normalized.startsWith("/") ? "" : "/"}${normalized}`);
}

function applyAppearanceSettings() {
  const accent = state.settings.accentColor || "#1f6feb";
  const opacity = Math.max(0, Math.min(100, Number(state.settings.backgroundOpacity) || 0));
  const backgroundUrl = state.settings.backgroundImagePath ? `url("${pathToFileUrl(state.settings.backgroundImagePath)}")` : "none";
  document.documentElement.style.setProperty("--blue", accent);
  document.documentElement.style.setProperty("--blue-soft", rgbaString(accent, state.theme === "dark" ? 0.28 : 0.12));
  document.documentElement.style.setProperty("--user-bg-image", backgroundUrl);
  document.documentElement.style.setProperty("--user-bg-opacity", String(opacity / 100));
  if (els.accentColor) {
    els.accentColor.value = accent;
  }
  if (els.accentColorValue) {
    els.accentColorValue.textContent = accent.toUpperCase();
  }
  if (els.backgroundOpacity) {
    els.backgroundOpacity.value = String(opacity);
  }
  if (els.backgroundOpacityValue) {
    els.backgroundOpacityValue.textContent = `${opacity}%`;
  }
  if (els.backgroundPreview) {
    els.backgroundPreview.textContent = state.settings.backgroundImagePath || "当前未设置自定义背景";
  }
}

function loadSettings() {
  const raw = localStorage.getItem("bxb-settings");
  if (raw) {
    try {
      state.settings = {
        ...state.settings,
        ...JSON.parse(raw),
      };
    } catch {}
  }
  syncSettingsToInputs();
}

function syncSettingsToInputs() {
  els.homeworkReminderEnabled.checked = Boolean(state.settings.homeworkReminderEnabled);
  els.homeworkAbsoluteTime.value = state.settings.homeworkAbsoluteTime;
  els.homeworkReminderContent.value = state.settings.homeworkReminderContent;
  els.classReminderEnabled.checked = Boolean(state.settings.classReminderEnabled);
  els.classReminderLeadTime.value = state.settings.classReminderLeadTime;
  els.motionEnabled.checked = Boolean(state.settings.motionEnabled);
  els.frostEnabled.checked = Boolean(state.settings.frostEnabled);
  els.accentColor.value = state.settings.accentColor;
  els.backgroundOpacity.value = String(state.settings.backgroundOpacity);
  for (const input of els.homeworkReminderDays.querySelectorAll('input[type="checkbox"]')) {
    input.checked = state.settings.homeworkReminderDays.includes(Number(input.value));
  }
  document.body.classList.toggle("reduced-motion", !state.settings.motionEnabled);
  document.body.classList.toggle("frost-off", !state.settings.frostEnabled);
  applyAppearanceSettings();
}

function saveSettings() {
  localStorage.setItem("bxb-settings", JSON.stringify(state.settings));
  syncSettingsToInputs();
}

function formatDateTime(value) {
  if (!value) {
    return "未提供";
  }
  const date = new Date(String(value).replaceAll("-", "/"));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function findCurrentTerm(summary, dashboard) {
  const terms = [...(summary?.availableTerms || []), ...(dashboard?.terms || [])];
  const currentTermId = String(summary?.currentTermId || "");

  if (currentTermId) {
    const matchedTerm =
      terms.find((term) => String(term?.id || "") === currentTermId) ||
      terms.find((term) => String(term?.name || term?.termName || "") === currentTermId);
    if (matchedTerm) {
      return matchedTerm;
    }
  }

  return terms.find((term) => Boolean(term?.status)) || terms[0] || null;
}

function normalizeTermName(summary, dashboard) {
  return findCurrentTerm(summary, dashboard)?.name || summary?.currentTermId || "学期未加载";
}

function parseApClassLabel(value) {
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(/\bG\s*([0-9]{1,2})\s*AP\s*([0-9]{1,2})\b/);
  if (!match) {
    return null;
  }

  return {
    grade: Number(match[1]),
    ap: Number(match[2]),
  };
}

function formatApClassLabel(parsed) {
  if (!parsed || !Number.isFinite(parsed.grade) || !Number.isFinite(parsed.ap)) {
    return "";
  }

  return `G${parsed.grade}ap${parsed.ap}班`;
}

function parseTermStartYear(term) {
  const text = String(term?.name || term?.termName || "");
  const match = text.match(/\b(20[0-9]{2})\s*-\s*20[0-9]{2}\b/);
  return match?.[1] ? Number(match[1]) : null;
}

function extractClassLabel(summary, dashboard) {
  const gpaCandidates = [
    dashboard.gpa?.selectedTransferClass?.className,
    dashboard.gpa?.selectedTransferClass?.srcClassName,
  ].filter(Boolean);

  for (const value of gpaCandidates) {
    const parsed = parseApClassLabel(value);
    if (parsed) {
      return formatApClassLabel(parsed);
    }
  }

  const alias = parseApClassLabel(summary.currentClass?.alias);
  if (alias) {
    const terms = [...(summary?.availableTerms || []), ...(dashboard?.terms || [])];
    const latestYear = Math.max(...terms.map((term) => parseTermStartYear(term)).filter(Number.isFinite));
    const currentYear = parseTermStartYear(findCurrentTerm(summary, dashboard));

    if (Number.isFinite(latestYear) && Number.isFinite(currentYear)) {
      const adjustedGrade = alias.grade - (latestYear - currentYear);
      if (adjustedGrade > 0) {
        return formatApClassLabel({ grade: adjustedGrade, ap: alias.ap });
      }
    }

    return formatApClassLabel(alias);
  }

  const aliasText = String(summary.currentClass?.alias || "")
    .replace(/\s+/g, "")
    .replace(/AP/gi, "ap");
  if (aliasText) {
    return aliasText.endsWith("班") ? aliasText : `${aliasText}班`;
  }

  return summary.currentClass?.name || "未分配班级";
}

function buildCourseMap(dashboard) {
  return new Map((dashboard.courses || []).map((course) => [String(course.id), course]));
}

function enrichTask(task, dashboard) {
  const courseMap = buildCourseMap(dashboard);
  const course = courseMap.get(String(task.courseId || ""));
  return {
    ...task,
    courseName: task.courseName || course?.name || "未分类科目",
  };
}

function getTodayKey() {
  const day = new Date().getDay();
  if (day === 0 || day === 6) {
    return 1;
  }
  return day;
}

function parseTimeRange(timeRange) {
  if (!timeRange || !timeRange.includes("-")) {
    return null;
  }
  const [start, end] = timeRange.split("-");
  const toMinutes = (value) => {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  };
  return { start: toMinutes(start), end: toMinutes(end) };
}

function getCurrentLessonIndex(timeSlots) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const entries = Object.entries(timeSlots || {}).map(([slot, value]) => [Number(slot), parseTimeRange(value)]);
  return entries.find(([_, range]) => range && currentMinutes >= range.start && currentMinutes <= range.end)?.[0] ?? null;
}

function getNextLessonIndex(timeSlots) {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const entries = Object.entries(timeSlots || {}).map(([slot, value]) => [Number(slot), parseTimeRange(value)]);
  return entries.find(([_, range]) => range && currentMinutes < range.start)?.[0] ?? null;
}

function getTodaySchedule(dashboard) {
  const todayKey = getTodayKey();
  const timeSlots = dashboard.timeSlots || {};
  const todaySchedule = dashboard.schedule?.[todayKey] || {};
  return Object.keys(timeSlots)
    .map((slotKey) => {
      const slot = Number(slotKey);
      const entry = todaySchedule[slot] || { time: timeSlots[slot], courses: [] };
      return {
        slot,
        time: entry.time || timeSlots[slot],
        courses: entry.courses || [],
      };
    });
}

function buildTaskPreview(task) {
  const parts = [
    task.scoreLevel ? `等级 ${task.scoreLevel}` : "",
    task.scoreTypeName || "",
    task.releaseTime ? `发布 ${formatDateTime(task.releaseTime)}` : "",
    task.endTime ? `截止 ${formatDateTime(task.endTime)}` : "",
    task.createName || task.creatorName || "",
    task.activityContent ? String(task.activityContent).replace(/\s+/g, " ").slice(0, 72) : "",
    task.description ? String(task.description).replace(/\s+/g, " ").slice(0, 72) : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function parseTaskTime(task) {
  const raw = task?.endTime || task?.releaseTime || "";
  const parsed = new Date(String(raw).replaceAll("-", "/")).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function getGradeRank(value) {
  const grade = String(value || "").trim().toUpperCase();
  const ranks = {
    "E+": 0,
    E: 1,
    "D+": 2,
    D: 3,
    "C-": 4,
    C: 5,
    "C+": 6,
    "B-": 7,
    B: 8,
    "B+": 9,
    "A-": 10,
    A: 11,
    "A+": 12,
  };
  return grade in ranks ? ranks[grade] : 999;
}

function isActionableTask(task) {
  return Number(task.isParticipate ?? 1) === 0;
}

function sortTasks(tasks, sortMode = "latest") {
  const items = [...tasks];
  if (sortMode === "lowest-grade") {
    return items.sort((a, b) => {
      const gradeDiff = getGradeRank(a.scoreLevel) - getGradeRank(b.scoreLevel);
      if (gradeDiff !== 0) {
        return gradeDiff;
      }
      const aTime = parseTaskTime(a) ?? Number.MAX_SAFE_INTEGER;
      const bTime = parseTaskTime(b) ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }

  return items.sort((a, b) => {
    const aTime = parseTaskTime(a) ?? 0;
    const bTime = parseTaskTime(b) ?? 0;
    return bTime - aTime;
  });
}

function buildDetailContent(detail) {
  const summary = detail.taskSummary || {};
  const task = detail.task || {};
  const contentBlocks = [
    detail.contentText,
    detail.answerText,
    task.activityContent,
  ].filter((value) => String(value || "").trim());

  if (contentBlocks.length > 0) {
    return contentBlocks.join("\n\n");
  }

  const fallbackLines = [
    summary.activityName || task.activityName ? `作业：${summary.activityName || task.activityName}` : "",
    summary.courseName || task.courseName ? `科目：${summary.courseName || task.courseName}` : "",
    task.statusName ? `状态：${task.statusName}` : "",
    task.creatorName ? `发布老师：${task.creatorName}` : "",
    task.releaseTime ? `发布时间：${formatDateTime(task.releaseTime)}` : "",
    task.endTime ? `截止时间：${formatDateTime(task.endTime)}` : "",
    detail.lastScore?.createTime ? `最近记录：${formatDateTime(detail.lastScore.createTime)}` : "",
    detail.mySubmissionList?.length ? `我的提交记录：${detail.mySubmissionList.length} 条` : "",
    detail.otherSubmissionCount ? `其他同学提交：${detail.otherSubmissionCount} 条` : "",
  ].filter(Boolean);

  return fallbackLines.join("\n");
}

function getHomeworkStats(dashboard) {
  const homework = (dashboard.homework || []).map((task) => enrichTask(task, dashboard));
  const unsubmitted = homework.filter(isActionableTask);
  const riskTasks = homework.filter((task) => String(task.scoreLevel || "").includes("E"));
  const upcoming = [...unsubmitted]
    .filter((task) => task.endTime && !task.isEnd)
    .sort((a, b) => (parseTaskTime(a) ?? Number.MAX_SAFE_INTEGER) - (parseTaskTime(b) ?? Number.MAX_SAFE_INTEGER));
  const nearest = upcoming[0] || null;
  const prioritized = [...unsubmitted].sort((a, b) => {
    const aOverdue = Boolean(a.isEnd);
    const bOverdue = Boolean(b.isEnd);
    if (aOverdue !== bOverdue) {
      return aOverdue ? -1 : 1;
    }
    const gradeDiff = getGradeRank(a.scoreLevel) - getGradeRank(b.scoreLevel);
    if (gradeDiff !== 0) {
      return gradeDiff;
    }
    const aTime = parseTaskTime(a) ?? Number.MAX_SAFE_INTEGER;
    const bTime = parseTaskTime(b) ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  return {
    pendingCount: unsubmitted.length,
    riskCount: riskTasks.length,
    nearest,
    unsubmitted,
    prioritized,
  };
}

function getFilteredTasks(dashboard) {
  const tasks = (dashboard.homework || []).map((task) => enrichTask(task, dashboard));
  const filtered =
    state.selectedCourseId === "all"
      ? tasks
      : tasks.filter((task) => String(task.courseId || "") === String(state.selectedCourseId));
  return sortTasks(filtered, state.homeworkSort);
}

function setBusy(isBusy, label = "处理中...") {
  els.refreshBtn.disabled = isBusy;
  els.authBtn.disabled = isBusy;
  els.loginSubmitBtn.disabled = isBusy;
  els.submitTaskBtn.disabled = isBusy;
  els.updateBtn.disabled = isBusy;
  els.settingsCheckUpdateBtn.disabled = isBusy;
  if (isBusy) {
    els.refreshBtn.textContent = label;
  } else {
    els.refreshBtn.textContent = "刷新";
    els.submitTaskBtn.textContent = "提交作业";
  }
}

function setBridgeReady(ready) {
  state.bridgeReady = Boolean(ready);
  els.refreshBtn.disabled = !ready;
  els.authBtn.disabled = !ready;
  els.updateBtn.disabled = !ready;
  els.settingsCheckUpdateBtn.disabled = !ready;
  if (!ready && !(state.access && state.access.locked)) {
    els.loginSubmitBtn.disabled = false;
    els.loginSubmitBtn.textContent = "登录";
  }
}

function truncateMiddle(value, max = 48) {
  const text = String(value || "");
  if (text.length <= max) {
    return text;
  }
  const head = text.slice(0, Math.ceil(max / 2) - 2);
  const tail = text.slice(-Math.floor(max / 2) + 1);
  return `${head}...${tail}`;
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "发生未知错误");
}

function showError(message, fallback = "") {
  const text = [message, fallback].filter(Boolean).join("\n");
  alert(text);
}

function renderAppMeta() {
  const meta = state.appMeta;
  if (!meta) {
    els.appVersionPill.textContent = "v--";
    els.aboutVersion.textContent = "--";
    els.aboutPlatform.textContent = "--";
    els.aboutDownloadsPath.textContent = "--";
    els.aboutLogsPath.textContent = "--";
    els.aboutPolicyUrl.textContent = "--";
    els.aboutRegistryStatus.textContent = "--";
    return;
  }
  els.appVersionPill.textContent = `v${meta.version}`;
  els.aboutVersion.textContent = meta.version;
  els.aboutPlatform.textContent = meta.platform || "--";
  els.aboutDownloadsPath.textContent = truncateMiddle(meta.downloadsDir, 56);
  els.aboutDownloadsPath.title = meta.downloadsDir || "";
  els.aboutLogsPath.textContent = truncateMiddle(meta.logsDir, 56);
  els.aboutLogsPath.title = meta.logsDir || "";
  els.aboutPolicyUrl.textContent = truncateMiddle(meta.policyUrl, 56);
  els.aboutPolicyUrl.title = meta.policyUrl || "";
  els.aboutRegistryStatus.textContent = state.registry?.synced
    ? "已同步到 GitHub"
    : state.registry?.reason === "missing-token"
      ? "仅本地缓存，未配置远程写入"
      : state.registry?.reason
        ? `待同步：${state.registry.reason}`
        : "等待首次登录";
}

function renderUpdateInfo() {
  const info = state.updateInfo;
  els.updateCard.classList.remove("is-attention", "is-success");

  if (!info) {
    els.updateStatusTitle.textContent = "还没有更新信息";
    els.updateStatusCopy.textContent = "点击检查更新后，这里会显示当前版本状态和下载入口。";
    return;
  }

  if (info.hasUpdate) {
    els.updateCard.classList.add("is-attention");
    els.updateStatusTitle.textContent = `发现新版本 v${info.latestVersion}`;
    els.updateStatusCopy.textContent = `当前版本 v${info.currentVersion}，建议前往发布页下载 ${info.releaseName || `v${info.latestVersion}`}。`;
    return;
  }

  els.updateCard.classList.add("is-success");
  els.updateStatusTitle.textContent = `当前已是最新版本 v${info.currentVersion}`;
  els.updateStatusCopy.textContent = "这台 mac 上的安装包已经和 GitHub 最新发布版本对齐。";
}

function renderTermSelector(dashboard) {
  const summary = dashboard?.session || loggedOutDashboard.session;
  const terms = dashboard?.terms?.length ? dashboard.terms : summary.availableTerms || [];

  if (!summary.ready) {
    els.termSelect.innerHTML = `<option value="">学期未加载</option>`;
    els.termSelect.disabled = true;
    return;
  }

  if (!terms.length) {
    els.termSelect.innerHTML = `<option value="">没有可切换的学期</option>`;
    els.termSelect.disabled = true;
    return;
  }

  const currentTerm = findCurrentTerm(summary, dashboard);
  const currentId = String(currentTerm?.id || "");
  els.termSelect.innerHTML = terms
    .map((term) => {
      const termId = String(term?.id || "");
      const termName = term?.name || term?.termName || "未命名学期";
      const selected = termId === currentId ? " selected" : "";
      return `<option value="${termId}"${selected}>${termName}</option>`;
    })
    .join("");
  els.termSelect.disabled = terms.length <= 1;
}

async function ensureAppMeta() {
  if (!bridge) {
    return;
  }
  const result = await bridge.getAppMeta();
  if (!result.ok) {
    return;
  }
  state.appMeta = result.data;
  renderAppMeta();
}

async function checkForUpdates({ silent = false } = {}) {
  if (!bridge) {
    return;
  }
  const originalTopLabel = els.updateBtn.textContent;
  const originalSettingsLabel = els.settingsCheckUpdateBtn.textContent;
  els.updateBtn.textContent = "检查中...";
  els.settingsCheckUpdateBtn.textContent = "检查中...";
  els.updateBtn.disabled = true;
  els.settingsCheckUpdateBtn.disabled = true;

  const result = await bridge.checkForUpdates();

  els.updateBtn.textContent = originalTopLabel;
  els.settingsCheckUpdateBtn.textContent = originalSettingsLabel;
  els.updateBtn.disabled = false;
  els.settingsCheckUpdateBtn.disabled = false;

  if (!result.ok) {
    if (!silent) {
      showError(result.error, "你也可以稍后直接打开 GitHub 发布页手动下载。");
    }
    return;
  }

  state.updateInfo = result.data;
  renderUpdateInfo();

  if (!silent && result.data?.hasUpdate) {
    const shouldOpen = window.confirm(`发现新版本 v${result.data.latestVersion}，现在打开发布页吗？`);
    if (shouldOpen) {
      bridge.openExternal(result.data.releaseUrl || state.appMeta?.releaseUrl || "");
    }
  }
}

async function openPathOrUrl(targetPath, fallbackUrl) {
  if (targetPath && bridge?.openExternal) {
    await bridge.openExternal(targetPath);
    return;
  }
  if (fallbackUrl) {
    await bridge?.openExternal(fallbackUrl);
    return;
  }
  showError("目标还没有准备好。");
}

async function waitForBridge(maxAttempts = 60, intervalMs = 250) {
  if (bridge) {
    setBridgeReady(true);
    return bridge;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = window.bxbApp || createPyWebViewBridge();
    if (candidate) {
      bridge = candidate;
      setBridgeReady(true);
      return bridge;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  setBridgeReady(false);
  throw new Error("桌面桥接未准备好，请重新启动应用。");
}

function setView(view) {
  state.activeView = view;
  for (const item of els.navItems) {
    item.classList.toggle("is-active", item.dataset.view === view);
  }
  for (const section of els.views) {
    section.classList.toggle("hidden", section.id !== `view-${view}`);
  }
  const meta = viewMeta[view];
  if (meta) {
    els.pageTitle.textContent = meta.title;
    els.pageSubtitle.textContent = meta.subtitle;
  }
}

function renderShell(summary, dashboard) {
  const ready = Boolean(summary.ready);
  const access = dashboard?.access || state.access || { locked: false };
  els.appShell.classList.toggle("is-logged-out", !ready);
  els.loginStage.classList.toggle("hidden", ready);
  els.workspace.classList.toggle("hidden", !ready);
  els.termSwitch.classList.toggle("hidden", !ready);
  els.updateBtn.classList.remove("hidden");
  els.refreshBtn.classList.toggle("hidden", !ready);
  els.authBtn.classList.toggle("hidden", !ready);
  els.sidebarStatus.textContent = ready ? `${summary.user?.name || "学生"} 已登录` : "未登录";
  els.lockCard.classList.toggle("hidden", !access.locked);
  els.lockMessage.textContent = access.locked ? access.reason || "管理员已临时停用当前桌面端，请稍后再试。" : "";
  els.loginUsername.disabled = access.locked;
  els.loginPassword.disabled = access.locked;
  els.rememberPassword.disabled = access.locked;
  els.loginSubmitBtn.disabled = access.locked;

  if (!ready) {
    els.pageTitle.textContent = access.locked ? "已锁定" : "登录";
    els.pageSubtitle.textContent = access.locked ? "当前软件访问已被管理员限制。" : "先登录，再查看今天课程、作业和提醒。";
    return;
  }

  const meta = viewMeta[state.activeView];
  els.pageTitle.textContent = meta.title;
  els.pageSubtitle.textContent = meta.subtitle;
}

function renderOverview(dashboard) {
  const summary = dashboard.session;
  const stats = getHomeworkStats(dashboard);
  els.studentName.textContent = summary.user?.name || "未登录";
  els.studentClass.textContent = extractClassLabel(summary, dashboard);
  els.termPill.textContent = normalizeTermName(summary, dashboard);
  els.heroNote.textContent = `${summary.user?.name || "你"} 今天优先看课程，再处理最近截止的作业。`;
  els.pendingCount.textContent = String(stats.pendingCount);
  els.riskCount.textContent = String(stats.riskCount);

  const notes = [
    stats.nearest
      ? `最近截止：${stats.nearest.courseName} · ${formatDateTime(stats.nearest.endTime)}`
      : "最近截止：当前没有未到期的待提交作业",
    stats.prioritized?.[0]
      ? `优先处理：${stats.prioritized[0].activityName || "未命名作业"}`
      : "优先处理：当前没有待处理项目",
  ];

  els.homeworkSummaryNotes.innerHTML = notes.map((note) => `<div class="metric-note">${note}</div>`).join("");

  const currentLesson = getCurrentLessonIndex(dashboard.timeSlots);
  const nextLesson = getNextLessonIndex(dashboard.timeSlots);
  const todayItems = getTodaySchedule(dashboard);

  if (todayItems.length === 0) {
    els.todayTimeline.innerHTML = `<div class="empty-state">今天没有抓取到课程安排。</div>`;
    return;
  }

  els.todayTimeline.innerHTML = todayItems
    .map((entry) => {
      const course = entry.courses[0];
      const tone = entry.slot === currentLesson ? "current" : entry.slot === nextLesson ? "next" : "";
      return `
        <article class="timeline-item ${tone} ${course ? "" : "empty"}">
          <div class="timeline-time">${entry.time}</div>
          <div>
            <div class="timeline-course">${course?.name || "空课时"}</div>
            <div class="timeline-meta">${course ? `${course?.teacher || "未提供教师"} · ${course?.room || "未提供教室"}` : "保留这个时间段，方便你看全天节奏"}</div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSchedule(dashboard) {
  const dayLabels = [
    { key: 1, label: "周一" },
    { key: 2, label: "周二" },
    { key: 3, label: "周三" },
    { key: 4, label: "周四" },
    { key: 5, label: "周五" },
  ];
  const todayKey = getTodayKey();
  const currentLesson = getCurrentLessonIndex(dashboard.timeSlots);
  const lessonKeys = Object.keys(dashboard.timeSlots || {}).map(Number);

  els.weeklySchedule.innerHTML = `
    <div class="week-head empty"></div>
    ${dayLabels
      .map((day) => `<div class="week-head ${todayKey === day.key ? "today" : ""}">${day.label}</div>`)
      .join("")}
    ${lessonKeys
      .map((lesson) => {
        const row = [`<div class="week-time">${dashboard.timeSlots?.[lesson] || "—"}</div>`];
        for (const day of dayLabels) {
          const slot = dashboard.schedule?.[day.key]?.[lesson] || { courses: [] };
          const course = slot.courses?.[0];
          row.push(`
            <div class="week-cell ${course ? "has-course" : ""} ${todayKey === day.key && currentLesson === lesson ? "current" : ""}">
              ${
                course
                  ? `<div class="cell-course">${course.name}</div><div class="cell-meta">${course.teacher || "未提供教师"}<br />${course.room || "未提供教室"}</div>`
                  : `<div class="cell-meta">空课时</div>`
              }
            </div>
          `);
        }
        return row.join("");
      })
      .join("")}
  `;
}

function renderSubjects(dashboard) {
  const items = [{ id: "all", name: "全部科目", count: dashboard.homework.length }].concat(
    (dashboard.courses || []).map((course) => ({
      id: course.id,
      name: course.name,
      count: (dashboard.homework || []).filter((task) => String(task.courseId || "") === String(course.id)).length,
    })),
  );

  if (!items.find((item) => String(item.id) === String(state.selectedCourseId))) {
    state.selectedCourseId = "all";
  }

  els.homeworkSubjects.innerHTML = items
    .map(
      (item) => `
        <button class="subject-item ${String(item.id) === String(state.selectedCourseId) ? "is-active" : ""}" data-course-id="${item.id}">
          <div class="subject-title">${item.name}</div>
          <div class="subject-meta">${item.count} 项作业</div>
        </button>
      `,
    )
    .join("");

  for (const button of els.homeworkSubjects.querySelectorAll(".subject-item")) {
    button.addEventListener("click", () => {
      state.selectedCourseId = button.dataset.courseId;
      state.selectedTaskId = null;
      state.selectedTaskDetail = null;
      renderHomework(dashboard);
    });
  }
}

function renderTaskList(dashboard) {
  const tasks = getFilteredTasks(dashboard);
  if (!tasks.length) {
    els.homeworkTaskList.innerHTML = `<div class="empty-state">当前科目下没有可显示的作业。</div>`;
    return;
  }

  if (!tasks.find((task) => String(task.id) === String(state.selectedTaskId))) {
    state.selectedTaskId = tasks[0].id;
  }

  els.homeworkTaskList.innerHTML = tasks
    .map((task) => {
      const isRisk = String(task.scoreLevel || "").includes("E");
      const badges = [
        task.scoreTypeName ? `<span class="task-badge">${task.scoreTypeName}</span>` : "",
        task.scoreLevel ? `<span class="task-badge grade">${task.scoreLevel}</span>` : "",
        task.endTime ? `<span class="task-badge warn">${formatDateTime(task.endTime)}</span>` : "",
        isRisk ? `<span class="task-badge danger">E+ / 待处理</span>` : "",
      ]
        .filter(Boolean)
        .join("");

      return `
        <button class="task-item ${String(task.id) === String(state.selectedTaskId) ? "is-active" : ""}" data-task-id="${task.id}">
          <div class="task-title">${task.activityName || "未命名作业"}</div>
          <div class="task-submeta">${task.courseName}</div>
          <div class="task-preview">${buildTaskPreview(task)}</div>
          <div class="task-badges">${badges}</div>
        </button>
      `;
    })
    .join("");

  for (const button of els.homeworkTaskList.querySelectorAll(".task-item")) {
    button.addEventListener("click", async () => {
      state.selectedTaskId = button.dataset.taskId;
      renderTaskList(dashboard);
      await openTaskDetail(button.dataset.taskId, dashboard);
    });
  }
}

function renderPickedFiles() {
  if (!state.selectedSubmitFiles.length) {
    els.pickedFiles.innerHTML = `<span class="picked-empty">未选择文件</span>`;
    return;
  }
  els.pickedFiles.innerHTML = state.selectedSubmitFiles
    .map((filePath) => `<span class="picked-file">${filePath.split(/[\\/]/).pop()}</span>`)
    .join("");
}

function renderTaskDetail(detail) {
  if (!detail) {
    els.detailTitle.textContent = "请选择作业";
    els.detailMeta.textContent = "";
    els.detailBody.innerHTML = `<div class="detail-empty">从中间列表选择一项作业后，这里会显示作业内容、附件和提交入口。</div>`;
    els.detailAttachments.innerHTML = `<div class="detail-empty">暂无附件</div>`;
    renderPickedFiles();
    return;
  }

  const summary = detail.taskSummary || detail.task || {};
  const attachments = [
    ...(detail.attachments || []),
    ...(detail.task?.fileList || []),
    ...(detail.mySubmissionAttachments || []),
  ].filter((attachment, index, items) => {
    const fileId = String(attachment?.fileId || attachment?.id || "");
    if (!fileId) {
      return false;
    }
    return index === items.findIndex((item) => String(item?.fileId || item?.id || "") === fileId);
  });

  els.detailTitle.textContent = summary.activityName || detail.task?.activityName || "作业详情";
  els.detailMeta.textContent = [
    summary.courseName || detail.task?.courseName || "",
    summary.scoreTypeName || detail.task?.scoreTypeName || detail.task?.statusName || "",
    summary.scoreLevel ? `等级：${summary.scoreLevel}` : detail.lastScore?.level ? `等级：${detail.lastScore.level}` : "",
    summary.endTime ? `截止：${formatDateTime(summary.endTime)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  els.detailBody.textContent = buildDetailContent(detail) || "这项作业暂时没有可展示的正文内容。";

  if (!attachments.length) {
    els.detailAttachments.innerHTML = `<div class="detail-empty">暂无附件</div>`;
  } else {
    els.detailAttachments.innerHTML = attachments
      .map((attachment) => {
        const fileName = attachment.fileName || attachment.name || attachment.originName || "未命名附件";
        const fileId = attachment.fileId || attachment.id || "";
        return `<button class="attachment-item" data-task-id="${summary.id || detail.taskId || ""}" data-file-id="${fileId}">${fileName}</button>`;
      })
      .join("");

    for (const button of els.detailAttachments.querySelectorAll(".attachment-item")) {
      button.addEventListener("click", async () => {
        const taskId = button.dataset.taskId;
        const fileId = button.dataset.fileId;
        if (!taskId || !fileId) {
          alert("这个附件缺少下载信息，暂时无法获取。");
          return;
        }
        if (!bridge) {
          return;
        }
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = `${originalLabel} · 下载中...`;
        const result = await bridge.downloadAttachment(taskId, fileId);
        button.disabled = false;
        button.textContent = originalLabel;
        if (!result.ok) {
          alert(result.error);
          return;
        }
        const savedPath = result.data?.path || "下载目录";
        const targetUri = result.data?.uri || savedPath;
        await bridge.openExternal(targetUri);
        alert(`附件已下载到：\n${savedPath}`);
      });
    }
  }

  renderPickedFiles();
}

async function openTaskDetail(taskId, dashboard = state.dashboard) {
  if (!bridge) {
    return;
  }
  state.selectedTaskId = taskId;
  state.selectedTaskDetail = null;
  els.detailTitle.textContent = "正在加载作业";
  els.detailMeta.textContent = "";
  els.detailBody.innerHTML = `<div class="detail-empty">正在获取作业内容...</div>`;
  els.detailAttachments.innerHTML = `<div class="detail-empty">正在获取附件...</div>`;

  const result = await bridge.openTask(taskId);
  if (!result.ok) {
    els.detailTitle.textContent = "作业加载失败";
    els.detailBody.innerHTML = `<div class="detail-empty">${result.error}</div>`;
    return;
  }

  state.selectedTaskDetail = result.data;
  state.selectedSubmitFiles = [];
  els.submitRemark.value = "";
  renderTaskList(dashboard);
  renderTaskDetail(result.data);
}

function renderHomework(dashboard) {
  renderSubjects(dashboard);
  renderTaskList(dashboard);
  if (state.selectedTaskId) {
    const currentTask = getFilteredTasks(dashboard).find((task) => String(task.id) === String(state.selectedTaskId));
    if (!currentTask) {
      state.selectedTaskId = null;
      state.selectedTaskDetail = null;
      renderTaskDetail(null);
      return;
    }
    if (!state.selectedTaskDetail || String(state.selectedTaskDetail.taskId || state.selectedTaskDetail.taskSummary?.id) !== String(state.selectedTaskId)) {
      openTaskDetail(state.selectedTaskId, dashboard);
      return;
    }
  }
  renderTaskDetail(state.selectedTaskDetail);
}

function hydrate(dashboard) {
  state.dashboard = dashboard;
  state.access = dashboard.access || null;
  state.registry = dashboard.registry || state.registry;
  const summary = dashboard.session || loggedOutDashboard.session;
  renderShell(summary, dashboard);
  renderTermSelector(dashboard);
  renderAppMeta();
  if (!summary.ready) {
    return;
  }
  renderOverview(dashboard);
  renderSchedule(dashboard);
  renderHomework(dashboard);
}

async function refreshDashboard() {
  if (!bridge) {
    try {
      await waitForBridge();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
      return;
    }
  }
  setBusy(true);
  const result = await bridge.loadDashboard();
  setBusy(false);
  if (!result.ok) {
    showError(result.error, "如果问题持续，可以在设置页打开日志目录查看运行日志。");
    return;
  }
  hydrate(result.data);
}

async function handleTermChange() {
  if (!bridge || !state.dashboard?.session?.ready) {
    return;
  }

  const targetTermId = String(els.termSelect.value || "");
  if (!targetTermId) {
    return;
  }

  const currentTerm = findCurrentTerm(state.dashboard.session, state.dashboard);
  if (String(currentTerm?.id || "") === targetTermId) {
    return;
  }

  els.termSelect.disabled = true;
  setBusy(true, "切换中...");
  const result = await bridge.setTerm(targetTermId);
  setBusy(false);

  if (!result.ok) {
    renderTermSelector(state.dashboard);
    showError(result.error, "学期切换失败，请稍后再试。");
    return;
  }

  state.selectedCourseId = "all";
  state.selectedTaskId = null;
  state.selectedTaskDetail = null;
  state.selectedSubmitFiles = [];
  hydrate(result.data);
}

async function handleCredentialLogin() {
  if (!bridge) {
    els.loginSubmitBtn.disabled = true;
    els.loginSubmitBtn.textContent = "连接中...";
    try {
      await waitForBridge();
    } catch (error) {
      els.loginSubmitBtn.disabled = false;
      els.loginSubmitBtn.textContent = "登录";
      showError(getErrorMessage(error));
      return;
    }
    els.loginSubmitBtn.disabled = false;
    els.loginSubmitBtn.textContent = "登录";
  }
  const username = els.loginUsername.value.trim();
  const password = els.loginPassword.value;
  if (!username || !password) {
    showError("请输入账号和密码");
    return;
  }
  els.loginSubmitBtn.disabled = true;
  els.loginSubmitBtn.textContent = "登录中...";
  const result = await bridge.loginWithCredentials(username, password);
  els.loginSubmitBtn.disabled = false;
  els.loginSubmitBtn.textContent = "登录";
  if (!result.ok) {
    showError(result.error, "请确认账号密码是否正确，或稍后重试。");
    return;
  }
  state.selectedCourseId = "all";
  state.selectedTaskId = null;
  state.selectedTaskDetail = null;
  state.authMemory = {
    rememberPassword: els.rememberPassword.checked,
    username,
    password: els.rememberPassword.checked ? password : "",
  };
  saveCredentials();
  hydrate(result.data);
}

async function handleAuth() {
  if (!bridge) {
    return;
  }
  if (!state.dashboard?.session?.ready) {
    const result = await bridge.login();
    if (!result.ok) {
      showError(result.error, "如果登录窗口没有继续，请检查网络后重试。");
      return;
    }
    hydrate(result.data);
    return;
  }
  setBusy(true, "退出中...");
  const result = await bridge.logout();
  setBusy(false);
  if (!result.ok) {
    showError(result.error);
    return;
  }
  state.selectedCourseId = "all";
  state.selectedTaskId = null;
  state.selectedTaskDetail = null;
  state.selectedSubmitFiles = [];
  hydrate(result.data);
}

async function pickSubmissionFiles() {
  if (!bridge) {
    return;
  }
  const result = await bridge.pickFiles();
  if (!result || result.canceled) {
    return;
  }
  state.selectedSubmitFiles = [...new Set([...(state.selectedSubmitFiles || []), ...(result.filePaths || [])])];
  renderPickedFiles();
}

async function pickBackgroundImage() {
  if (!bridge) {
    return;
  }
  const result = await bridge.pickBackgroundImage();
  if (!result || result.canceled || !result.filePath) {
    return;
  }
  state.settings.backgroundImagePath = result.filePath;
  saveSettings();
}

function clearBackgroundImage() {
  state.settings.backgroundImagePath = "";
  saveSettings();
}

async function submitCurrentTask() {
  if (!bridge) {
    return;
  }
  if (!state.selectedTaskDetail?.taskId && !state.selectedTaskDetail?.taskSummary?.id) {
    alert("请先选择一项作业");
    return;
  }
  const taskId = state.selectedTaskDetail.taskId || state.selectedTaskDetail.taskSummary?.id;
  const remark = els.submitRemark.value.trim();
  if (!remark && state.selectedSubmitFiles.length === 0) {
    alert("备注和附件不能都为空");
    return;
  }

  els.submitTaskBtn.disabled = true;
  els.submitTaskBtn.textContent = "提交中...";
  const result = await bridge.submitTask({
    taskId,
    remark,
    filePaths: state.selectedSubmitFiles,
  });
  els.submitTaskBtn.disabled = false;
  els.submitTaskBtn.textContent = "提交作业";

  if (!result.ok) {
    showError(result.error, "如连续失败，可以打开日志目录把最新日志发给我。");
    return;
  }

  alert("作业提交成功");
  state.selectedSubmitFiles = [];
  els.submitRemark.value = "";
  renderPickedFiles();
  await refreshDashboard();
}

function bindEvents() {
  els.navItems.forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
  els.refreshBtn.addEventListener("click", refreshDashboard);
  els.authBtn.addEventListener("click", handleAuth);
  els.termSelect.addEventListener("change", handleTermChange);
  els.loginSubmitBtn.addEventListener("click", handleCredentialLogin);
  els.loginPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleCredentialLogin();
    }
  });
  els.pickFilesBtn.addEventListener("click", pickSubmissionFiles);
  els.submitTaskBtn.addEventListener("click", submitCurrentTask);
  els.updateBtn.addEventListener("click", () => checkForUpdates());
  els.settingsCheckUpdateBtn.addEventListener("click", () => checkForUpdates());
  els.themeChips.forEach((chip) => chip.addEventListener("click", () => setTheme(chip.dataset.theme)));

  const settingBindings = [
    [els.homeworkReminderEnabled, "homeworkReminderEnabled", "checked"],
    [els.homeworkAbsoluteTime, "homeworkAbsoluteTime", "value"],
    [els.homeworkReminderContent, "homeworkReminderContent", "value"],
    [els.classReminderEnabled, "classReminderEnabled", "checked"],
    [els.classReminderLeadTime, "classReminderLeadTime", "value"],
    [els.motionEnabled, "motionEnabled", "checked"],
    [els.frostEnabled, "frostEnabled", "checked"],
    [els.accentColor, "accentColor", "value"],
  ];

  for (const [element, key, prop] of settingBindings) {
    element.addEventListener("change", () => {
      state.settings[key] = element[prop];
      saveSettings();
    });
  }

  els.backgroundOpacity.addEventListener("input", () => {
    state.settings.backgroundOpacity = Number(els.backgroundOpacity.value);
    saveSettings();
  });

  els.pickBackgroundBtn.addEventListener("click", pickBackgroundImage);
  els.clearBackgroundBtn.addEventListener("click", clearBackgroundImage);

  els.homeworkSort.addEventListener("change", () => {
    state.homeworkSort = els.homeworkSort.value;
    if (state.dashboard?.session?.ready) {
      renderHomework(state.dashboard);
    }
  });

  els.rememberPassword.addEventListener("change", () => {
    state.authMemory.rememberPassword = els.rememberPassword.checked;
    if (!state.authMemory.rememberPassword) {
      state.authMemory.password = "";
    }
    state.authMemory.username = els.loginUsername.value.trim();
    saveCredentials();
  });

  els.loginUsername.addEventListener("input", () => {
    if (!els.rememberPassword.checked) {
      return;
    }
    state.authMemory.username = els.loginUsername.value.trim();
    saveCredentials();
  });

  els.loginPassword.addEventListener("input", () => {
    if (!els.rememberPassword.checked) {
      return;
    }
    state.authMemory.password = els.loginPassword.value;
    saveCredentials();
  });

  for (const input of els.homeworkReminderDays.querySelectorAll('input[type="checkbox"]')) {
    input.addEventListener("change", () => {
      state.settings.homeworkReminderDays = [...els.homeworkReminderDays.querySelectorAll('input[type="checkbox"]:checked')]
        .map((checkbox) => Number(checkbox.value))
        .sort((a, b) => a - b);
      saveSettings();
    });
  }

  if (els.minimizeBtn) {
    els.minimizeBtn.addEventListener("click", () => bridge?.window.minimize());
    els.maximizeBtn.addEventListener("click", () => bridge?.window.toggleMaximize());
    els.closeBtn.addEventListener("click", () => bridge?.window.close());
  }

  els.contactLinks.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.external;
      if (target) {
        bridge?.openExternal(target);
      }
    });
  });

  els.openReleaseBtn.addEventListener("click", () => {
    const url = state.updateInfo?.releaseUrl || state.appMeta?.releaseUrl;
    if (url) {
      bridge?.openExternal(url);
    }
  });

  els.openDownloadsBtn.addEventListener("click", () => {
    const target = state.appMeta?.downloadsDir;
    if (target) {
      bridge?.revealPath(target);
    }
  });

  els.openLogsBtn.addEventListener("click", () => {
    const target = state.appMeta?.logsDir;
    if (target) {
      bridge?.revealPath(target);
    }
  });

  els.openAgreementBtn.addEventListener("click", () => openPathOrUrl(state.appMeta?.agreementPath, state.appMeta?.githubUrl));
  els.openPrivacyBtn.addEventListener("click", () => openPathOrUrl(state.appMeta?.privacyPath, state.appMeta?.githubUrl));
  els.openReleaseNotesBtn.addEventListener("click", () => openPathOrUrl(state.appMeta?.releaseNotesPath, state.appMeta?.releaseUrl));
}

bindEvents();
loadTheme();
loadSavedCredentials();
loadSettings();
els.homeworkSort.value = state.homeworkSort;
setView("overview");
setBridgeReady(Boolean(bridge));
hydrate(loggedOutDashboard);
renderTaskDetail(null);
renderAppMeta();
renderUpdateInfo();

if (window.pywebview) {
  window.addEventListener("pywebviewready", () => {
    bridge = createPyWebViewBridge() || bridge;
    setBridgeReady(Boolean(bridge));
    ensureAppMeta();
    refreshDashboard();
    checkForUpdates({ silent: true });
  });
  setTimeout(() => {
    bridge = createPyWebViewBridge() || bridge;
    setBridgeReady(Boolean(bridge));
    ensureAppMeta();
    refreshDashboard();
    checkForUpdates({ silent: true });
  }, 300);
} else {
  ensureAppMeta();
  refreshDashboard();
  checkForUpdates({ silent: true });
}
