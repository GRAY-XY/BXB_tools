import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

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
  try {
    return await chromium.launch({
      headless,
      channel: "chromium",
    });
  } catch (error) {
    throw new Error(
      `Failed to launch Playwright Chromium. Install the browser payload or extract chrome-win64.zip to the Playwright cache. Original error: ${error.message}`,
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

function parseTextBuffer(buffer, extension) {
  const text = buffer.toString("utf8");
  if (extension === ".html" || extension === ".htm") {
    return stripHtml(text);
  }

  return text;
}

export class BanxuebangClient {
  constructor(store) {
    this.store = store;
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

    const currentSubject =
      subjectList.find(
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
      courses: toArray(session.context.subjectList).map(summarizeCourse),
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

  async listHomework({ listType = "all", page = 1, size = 10 } = {}) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const { userInfo, curSubject, currTermId } = session.context;
    if (!userInfo?.id || !curSubject?.id || !curSubject?.classId || !currTermId) {
      throw new Error("Current session does not have enough context to query homework.");
    }

    const query = {
      page,
      size,
      leamTermIds: currTermId,
      classId: curSubject.classId,
    };

    let normalizedListType = -1;
    if (listType === "latest") {
      normalizedListType = 1;
    } else if (listType === "pending") {
      normalizedListType = 2;
    }

    let unsubmittedHomeworkList = [];
    if (normalizedListType === -1) {
      const unsubmittedResponse = safeBusinessResult(
        await this.request(
          session,
          "GET",
          `/gateway/bxb/student/${userInfo.id}/course/${curSubject.id}/un-submit-homework`,
          {
            params: {
              leamTermIds: currTermId,
              classId: curSubject.classId,
            },
          },
        ),
        "un-submit-homework",
      );
      unsubmittedHomeworkList = Array.isArray(unsubmittedResponse.data)
        ? unsubmittedResponse.data.map(enrichHomeworkRecord)
        : [];
    }

    const homeworkEndpoint =
      normalizedListType === -1
        ? `/gateway/bxb/student/${userInfo.id}/course/${curSubject.id}/page-query-homework`
        : `/gateway/bxb/student/${userInfo.id}/course/${curSubject.id}/page-query-homework2`;

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
    const homeworkList = Array.isArray(data.aaData) ? data.aaData.map(enrichHomeworkRecord) : [];

    return {
      context: this.summarizeSession(session),
      query: {
        ...query,
        listType: normalizedListType,
      },
      totalRecords: data.iTotalRecords ?? homeworkList.length,
      unsubmittedHomeworkList,
      homeworkList,
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

  async getTaskDetail(taskId, { includeOtherSubmissions = false } = {}) {
    const session = await this.requireSession();
    await this.refreshContext(session);

    const { userInfo, curSubject } = session.context;
    if (!userInfo?.id || !curSubject?.classId) {
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
              params: { classId: curSubject.classId },
            },
          ).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      this.request(
        session,
        "GET",
        `/gateway/bxb/activityWork/homework/${taskId}/student/${userInfo.id}/last-score`,
        {
          params: { classId: curSubject.classId },
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
    const downloadDir = directory || path.join(process.cwd(), ".banxuebang", "downloads");
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
}
