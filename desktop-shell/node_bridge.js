import { readFile, rm, readdir } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BanxuebangClient } from "../src/banxuebang-client.js";
import { SessionStore } from "../src/session-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new BanxuebangClient(new SessionStore());

const ALL_SUBJECT_ID = "__all_courses__";
const HOMEWORK_PAGE_SIZE = 50;
const HOMEWORK_MAX_PAGES_PER_COURSE = 2;
const HOMEWORK_FETCH_CONCURRENCY = 4;

function ok(data) {
  return { ok: true, data };
}

function dedupeById(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const id = item?.id ? String(item.id) : JSON.stringify(item);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function sortTasks(tasks = []) {
  return [...tasks].sort((a, b) => {
    const aTime = new Date(String(a?.endTime || a?.releaseTime || "").replaceAll("-", "/")).getTime() || 0;
    const bTime = new Date(String(b?.endTime || b?.releaseTime || "").replaceAll("-", "/")).getTime() || 0;
    return bTime - aTime;
  });
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function summarizeCourse(course) {
  return {
    id: course.id,
    classId: course.classId,
    name: course.cnName || course.name || null,
    color: course.color || null,
    unSubmitCount: course.unSubmitCount ?? null,
    allSubjects: false,
  };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results;
}

async function fetchHomeworkForSubject(session, subject) {
  const homeworkList = [];
  const unsubmittedHomeworkList = [];

  for (let page = 1; page <= HOMEWORK_MAX_PAGES_PER_COURSE; page += 1) {
    const pageResult = await client.queryHomeworkForSubject(session, subject, {
      listType: "all",
      page,
      size: HOMEWORK_PAGE_SIZE,
      includeUnsubmitted: false,
    });
    homeworkList.push(...(pageResult.homeworkList || []));
    unsubmittedHomeworkList.push(...(pageResult.unsubmittedHomeworkList || []));

    const totalRecords = Number(pageResult.totalRecords || homeworkList.length);
    const totalPages = Math.max(1, Math.ceil(totalRecords / HOMEWORK_PAGE_SIZE));
    if (page >= totalPages) {
      break;
    }
  }

  return {
    homeworkList: dedupeById(homeworkList),
    unsubmittedHomeworkList: dedupeById(unsubmittedHomeworkList),
  };
}

async function buildHomeworkAcrossCourses({ skipContextRefresh = false } = {}) {
  const session = await client.requireSession();
  if (!skipContextRefresh) {
    await client.refreshContext(session);
  }

  const subjectList = toArray(session.context.subjectList).filter(
    (subject) => subject?.id && subject?.classId,
  );
  const courses = [
    {
      id: ALL_SUBJECT_ID,
      classId: null,
      name: "全部课程",
      color: "#0067c0",
      unSubmitCount: null,
      allSubjects: true,
    },
    ...subjectList.map(summarizeCourse),
  ];

  const perSubjectResults = await runWithConcurrency(
    subjectList,
    HOMEWORK_FETCH_CONCURRENCY,
    async (subject) => fetchHomeworkForSubject(session, subject).catch(() => ({
      homeworkList: [],
      unsubmittedHomeworkList: [],
    })),
  );

  const allHomework = perSubjectResults.flatMap((result) => result.homeworkList);

  const allUnsubmitted = perSubjectResults.flatMap((result) => result.unsubmittedHomeworkList);

  return {
    courses,
    homework: sortTasks(dedupeById(allHomework)),
    pendingHomework: sortTasks(dedupeById(allUnsubmitted)),
  };
}

function parsePayload(raw) {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function firstInt(raw, keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (value == null || value === "") {
      continue;
    }
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parsePercentValue(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    if (value <= 1 && value >= 0) {
      return Math.round(value * 100);
    }
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  const text = String(value).trim();
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (text.includes(".") && parsed <= 1) {
    return Math.round(parsed * 100);
  }
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function extractSubmissionStats(raw = {}) {
  for (const key of [
    "submitRate",
    "participateRate",
    "partakeRate",
    "classSubmitRate",
    "submitPercent",
    "participatePercent",
  ]) {
    const percent = parsePercentValue(raw[key]);
    if (percent != null) {
      return { percent, submittedCount: null, totalCount: null };
    }
  }

  const submitted = firstInt(raw, [
    "submitNum",
    "submitCount",
    "submittedNum",
    "submittedCount",
    "participateNum",
    "participateCount",
    "partakeNum",
    "partakeCount",
    "workSubmitNum",
    "submitWorkNum",
    "joinNum",
    "submitStudentNum",
    "submitWorkCount",
    "iSubmitCount",
    "submitTotal",
  ]);
  const total = firstInt(raw, [
    "totalNum",
    "totalCount",
    "studentNum",
    "studentCount",
    "classStudentNum",
    "classStudentCount",
    "classNum",
    "totalStudentNum",
    "totalStudentCount",
    "studentTotal",
    "classTotal",
    "classSize",
    "iTotalCount",
    "peopleNum",
  ]);

  if (submitted != null && total != null && total > 0) {
    return {
      submittedCount: submitted,
      totalCount: total,
      percent: Math.max(0, Math.min(100, Math.round((submitted / total) * 100))),
    };
  }

  return null;
}

async function resolveTaskSubmitStats(taskId, classId, raw = {}) {
  const parsed = extractSubmissionStats(raw);
  if (parsed?.percent != null) {
    return parsed;
  }

  const session = await client.requireSession();
  const submittedResponse = await client
    .request(session, "GET", `/gateway/bxb/activityWork/homework/${taskId}/submitted/list`, {
      params: { classId },
    })
    .catch(() => ({ data: [] }));
  const submittedCount = Array.isArray(submittedResponse.data)
    ? submittedResponse.data.length
    : 0;

  if (parsed?.totalCount != null && parsed.totalCount > 0) {
    return {
      submittedCount,
      totalCount: parsed.totalCount,
      percent: Math.max(
        0,
        Math.min(100, Math.round((submittedCount / parsed.totalCount) * 100)),
      ),
    };
  }

  if (submittedCount > 0) {
    return { submittedCount, totalCount: null, percent: null };
  }

  return null;
}

async function resolveTaskSubmitStatsBatch(tasks = []) {
  const validTasks = tasks.filter((task) => task?.taskId);
  const results = await runWithConcurrency(validTasks, 4, async (task) => ({
    taskId: task.taskId,
    stats: await resolveTaskSubmitStats(task.taskId, task.classId, task.raw || {}),
  }));
  const statsByTaskId = {};
  for (const entry of results) {
    if (entry?.taskId) {
      statsByTaskId[entry.taskId] = entry.stats;
    }
  }
  return statsByTaskId;
}

function emptyDashboard(summary) {
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

async function buildDashboardPayload({ includeGpa = true } = {}) {
  const session = await client.getSession();
  const summary = client.summarizeSession(session);

  if (!summary.ready) {
    return emptyDashboard(summary);
  }

  const refreshedSummary = await client.refreshContext(session);

  const [termsResult, homeworkAggregate, scheduleResult] = await Promise.all([
    client.listTerms({ skipContextRefresh: true }).catch(() => ({ terms: [] })),
    buildHomeworkAcrossCourses({ skipContextRefresh: true }).catch(() => ({
      courses: [],
      homework: [],
      pendingHomework: [],
    })),
    client.getSchedule({ skipContextRefresh: true }).catch(() => ({
      schedule: {},
      timeSlots: {},
      hasData: false,
    })),
  ]);

  let gpaResult = null;
  if (includeGpa) {
    gpaResult = await client
      .getCurrentSubjectGpa({ skipContextRefresh: true })
      .catch(() => null);
  }

  return {
    session: refreshedSummary,
    terms: termsResult.terms || [],
    courses: homeworkAggregate.courses || [],
    homework: homeworkAggregate.homework || [],
    pendingHomework: homeworkAggregate.pendingHomework || [],
    schedule: scheduleResult.schedule || {},
    timeSlots: scheduleResult.timeSlots || {},
    notices: [],
    unreadCount: null,
    gpa: gpaResult,
    currentTask: null,
  };
}

async function checkForUpdates() {
  let currentVersion = "0.0.0";
  try {
    const pkgText = await readFile(path.join(__dirname, "..", "package.json"), "utf8");
    currentVersion = JSON.parse(pkgText).version || "0.0.0";
  } catch {
    // fall through with default
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      "https://api.github.com/repos/GRAY-XY/BXB_tools/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "BXB-Student-Desktop",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const latestVersion = String(data.tag_name || "").replace(/^[vV]/, "") || currentVersion;
            const hasUpdate = compareVersions(currentVersion, latestVersion) < 0;
            resolve({
              currentVersion,
              latestVersion,
              hasUpdate,
              releaseName: data.name || data.tag_name || latestVersion,
              releaseUrl: data.html_url || "https://github.com/GRAY-XY/BXB_tools/releases",
              publishedAt: data.published_at || null,
              body: data.body || "",
            });
          } catch (error) {
            reject(new Error(`Failed to parse GitHub release response: ${error.message}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(8000, () => { req.destroy(new Error("Update check timed out.")); });
    req.end();
  });
}

function compareVersions(a, b) {
  const parse = (v) => String(v || "0").replace(/^[vV]/, "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const aParts = parse(a);
  const bParts = parse(b);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i++) {
    const diff = (aParts[i] || 0) - (bParts[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function performUninstall() {
  const appSupportDir = process.env.BANXUEBANG_APP_SUPPORT_DIR;
  const sessionFile = process.env.BANXUEBANG_SESSION_FILE;

  const candidates = [
    appSupportDir,
    sessionFile ? path.dirname(sessionFile) : null,
    path.join(os.homedir(), "Library", "Application Support", "BXB Student"),
    path.join(os.homedir(), "AppData", "Roaming", "BXB Student"),
  ].filter(Boolean);

  const removed = [];
  const errors = [];

  for (const target of candidates) {
    try {
      await readdir(target);
      await rm(target, { recursive: true, force: true });
      removed.push(target);
    } catch (error) {
      if (error.code !== "ENOENT") {
        errors.push(`${target}: ${error.message}`);
      }
    }
  }

  return {
    removed,
    errors,
    note: "应用数据已清除。请手动将应用程序移到废纸篓以完成卸载。",
  };
}

async function run(command, payload) {
  switch (command) {
    case "dashboard":
      return ok(
        await buildDashboardPayload({
          includeGpa: payload.includeGpa !== false,
        }),
      );
    case "gpa":
      return ok(
        await client
          .getCurrentSubjectGpa({ skipContextRefresh: true })
          .catch(() => null),
      );
    case "login":
      await client.interactiveLogin({ headless: false, timeoutMs: 300000 });
      return ok(await buildDashboardPayload());
    case "login-with-credentials":
      await client.loginWithCredentials({
        username: payload.username,
        password: payload.password,
        headless: false,
        timeoutMs: 60000,
      });
      return ok(await buildDashboardPayload());
    case "logout":
      await client.clearSession();
      return ok(await buildDashboardPayload());
    case "set-term":
      await client.setCurrentTerm(payload.termId);
      return ok(await buildDashboardPayload());
    case "set-subject": {
      const sessionSummary = payload.subjectId
        ? await client.setCurrentSubject(payload.subjectId, payload.classId)
        : await client.setCurrentSubjectByName(payload.subjectName, payload.classId);
      if (payload.lightweight) {
        return ok({ lightweight: true, session: sessionSummary });
      }
      return ok(await buildDashboardPayload());
    }
    case "task-submit-stats":
      return ok(
        await resolveTaskSubmitStats(
          payload.taskId,
          payload.classId,
          payload.raw || {},
        ),
      );
    case "task-submit-stats-batch":
      return ok({
        statsByTaskId: await resolveTaskSubmitStatsBatch(payload.tasks || []),
      });
    case "open-task": {
      const taskDetail = await client.getTaskDetail(payload.taskId, { includeOtherSubmissions: true });

      const highScoreSubmissions = [];
      const isTaskEnded = taskDetail.task?.isEnd ||
                         (taskDetail.task?.endTime && new Date(taskDetail.task.endTime) < new Date());

      if (isTaskEnded) {
        for (const submission of taskDetail.submittedList || []) {
          const score = submission.score || 0;
          if (score >= 90) {
            highScoreSubmissions.push({
              id: submission.id,
              score: submission.score,
              academicScore: submission.academicScore,
              level: submission.level,
              receiptTime: submission.receiptTime,
              remark: submission.remark,
              fileList: submission.fileList,
              userName: `A同学 #${highScoreSubmissions.length + 1}`,
              accountAvatar: null,
              sexCode: null,
            });
          }
        }
      }

      return ok({
        ...taskDetail,
        submittedList: highScoreSubmissions,
        peerSubmissionAttachments: highScoreSubmissions.flatMap(sub =>
          (sub.fileList || []).map(file => ({
            fileId: file.fileId || file.id,
            fileName: file.fileName || file.name,
            name: file.name || file.fileName,
            fileExt: file.fileExt || '',
            source: 'peer-submission',
          }))
        ),
        highScoreSubmissions,
      });
    }
    case "submit-task":
      return ok(
        await client.submitTaskResult({
          taskId: payload.taskId,
          remark: payload.remark || "",
          filePaths: payload.filePaths || [],
        }),
      );
    case "download-attachment":
      return ok(
        await client.downloadTaskAttachment({
          taskId: payload.taskId,
          fileId: payload.fileId,
          directory: payload.directory,
        }),
      );
    case "list-private-contacts":
      return ok(await client.listPrivateMessageContacts());
    case "get-private-thread":
      return ok(
        await client.getPrivateMessageThread(payload.contact, {
          size: payload.size || 20,
          endTime: payload.endTime || "",
        }),
      );
    case "send-private-message":
      return ok(await client.sendPrivateMessageText(payload.contact, payload.content));
    case "check-updates":
      return ok(await checkForUpdates());
    case "uninstall":
      return ok(await performUninstall());
    default:
      throw new Error(`Unknown desktop-shell bridge command: ${command}`);
  }
}

function writeDaemonLine(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function startDaemon() {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  writeDaemonLine({ ok: true, event: "ready" });

  let chain = Promise.resolve();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    chain = chain.then(async () => {
      let request;
      try {
        request = JSON.parse(trimmed);
      } catch (error) {
        writeDaemonLine({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }

      const id = request?.id;
      const command = request?.command;
      if (!command) {
        writeDaemonLine({
          id,
          ok: false,
          error: "Bridge request is missing command.",
        });
        return;
      }

      try {
        const result = await run(command, request.payload || {});
        writeDaemonLine({
          id,
          ok: result?.ok !== false,
          data: result?.data ?? null,
          error: result?.error,
        });
      } catch (error) {
        writeDaemonLine({
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

const command = process.argv[2];
const rawPayload = process.argv[3];

if (command === "--daemon") {
  startDaemon().catch((error) => {
    writeDaemonLine({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
} else if (command) {
  run(command, parsePayload(rawPayload))
    .then((result) => {
      console.log(JSON.stringify(result));
    })
    .catch((error) => {
      console.log(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      process.exit(1);
    });
} else {
  console.log(
    JSON.stringify({
      ok: false,
      error: "Usage: node node_bridge.js <command> [payload-json] | --daemon",
    }),
  );
  process.exit(1);
}
