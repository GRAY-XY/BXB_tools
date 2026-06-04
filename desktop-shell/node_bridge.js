import { BanxuebangClient } from "../src/banxuebang-client.js";
import { SessionStore } from "../src/session-store.js";

const client = new BanxuebangClient(new SessionStore());

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

async function listTasksForCourse(course, { listType = "all", size = 50 } = {}) {
  const firstPage = await client.listTasks({
    listType,
    subjectId: course.id,
    classId: course.classId,
    page: 1,
    size,
  });

  const totalRecords = Number(firstPage.totalRecords || firstPage.homeworkList?.length || 0);
  const totalPages = Math.max(1, Math.ceil(totalRecords / size));
  let homeworkList = [...(firstPage.homeworkList || [])];
  let unsubmittedHomeworkList = [...(firstPage.unsubmittedHomeworkList || [])];

  for (let page = 2; page <= totalPages; page += 1) {
    const pageResult = await client.listTasks({
      listType,
      subjectId: course.id,
      classId: course.classId,
      page,
      size,
    });
    homeworkList.push(...(pageResult.homeworkList || []));
    unsubmittedHomeworkList.push(...(pageResult.unsubmittedHomeworkList || []));
  }

  return {
    homeworkList: dedupeById(homeworkList),
    unsubmittedHomeworkList: dedupeById(unsubmittedHomeworkList),
  };
}

async function buildHomeworkAcrossCourses(summary) {
  const coursesResult = await client.listCourses().catch(() => ({ courses: [] }));
  const courses = coursesResult.courses || [];
  const originalSubject = summary.currentSubject;
  const allHomework = [];
  const allPending = [];

  for (const course of courses) {
    const allResult = await listTasksForCourse(course, { listType: "all", size: 50 }).catch(() => ({
      homeworkList: [],
      unsubmittedHomeworkList: [],
    }));
    const pendingResult = await listTasksForCourse(course, { listType: "pending", size: 50 }).catch(() => ({
      homeworkList: [],
      unsubmittedHomeworkList: [],
    }));
    allHomework.push(...allResult.homeworkList);
    allPending.push(...pendingResult.homeworkList, ...allResult.unsubmittedHomeworkList);
  }

  if (originalSubject?.id) {
    await client.setCurrentSubject(originalSubject.id, originalSubject.classId).catch(() => {});
  }

  return {
    courses,
    homework: sortTasks(dedupeById(allHomework)),
    pendingHomework: sortTasks(dedupeById(allPending)),
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

async function buildDashboardPayload() {
  const session = await client.getSession();
  const summary = client.summarizeSession(session);

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

  const [termsResult, homeworkAggregate, gpaResult, scheduleResult] =
    await Promise.all([
      client.listTerms().catch(() => ({ terms: [] })),
      buildHomeworkAcrossCourses(summary).catch(() => ({
        courses: [],
        homework: [],
        pendingHomework: [],
      })),
      client.getCurrentSubjectGpa().catch(() => null),
      client.getSchedule().catch(() => ({
        schedule: {},
        timeSlots: {},
        hasData: false,
      })),
    ]);

  return {
    session: summary,
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

async function run(command, payload) {
  switch (command) {
    case "dashboard":
      return ok(await buildDashboardPayload());
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
    case "set-subject":
      if (payload.subjectId) {
        await client.setCurrentSubject(payload.subjectId, payload.classId);
      } else {
        await client.setCurrentSubjectByName(payload.subjectName, payload.classId);
      }
      return ok(await buildDashboardPayload());
    case "open-task":
      const taskDetail = await client.getTaskDetail(payload.taskId, { includeOtherSubmissions: true });
      
      // 只在作业结束后展示高分提交（A和A+），且匿名化
      const highScoreSubmissions = [];
      // 检查作业是否结束（从 task 对象或 endTime 判断）
      const isTaskEnded = taskDetail.task?.isEnd || 
                         (taskDetail.task?.endTime && new Date(taskDetail.task.endTime) < new Date());
      
      if (isTaskEnded) {
        for (const submission of taskDetail.submittedList || []) {
          // 根据 score 判断等级（假设 90+ 为 A/A+）
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
              // 匿名化：用编号代替姓名
              userName: `A同学 #${highScoreSubmissions.length + 1}`,
              accountAvatar: null,  // 移除头像
              sexCode: null,  // 移除性别
            });
          }
        }
      }
      
      return ok({
        ...taskDetail,
        submittedList: highScoreSubmissions,  // 只返回高分提交
        peerSubmissionAttachments: highScoreSubmissions.flatMap(sub => 
          (sub.fileList || []).map(file => ({
            fileId: file.fileId || file.id,
            fileName: file.fileName || file.name,
            name: file.name || file.fileName,
            fileExt: file.fileExt || '',
            source: 'peer-submission',
          }))
        ),
        highScoreSubmissions,  // 保留简化版本用于卡片展示
      });
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
    default:
      throw new Error(`Unknown desktop-shell bridge command: ${command}`);
  }
}

const [, , command, rawPayload] = process.argv;

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
