const OMITTED_KEYS = new Set([
  "accessToken",
  "refreshToken",
  "sessionFile",
  "baseUrl",
  "apiKey",
  "apiKeyMasked",
  "authorization",
  "cookie",
  "cookies",
  "raw",
  "courseResults",
  "draftDirectory",
  "dataUrl",
  "imageDataUrl",
  "base64",
]);

function truncateText(value, maxChars = 20000) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function pick(source, keys) {
  return Object.fromEntries(keys
    .filter((key) => source?.[key] !== undefined && source?.[key] !== null && source?.[key] !== "")
    .map((key) => [key, source[key]]));
}

function compactSession(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ready: Boolean(source.ready),
    ...pick(source, ["capturedAt", "loginSource", "currentTermId"]),
    ...(source.user ? { user: pick(source.user, ["id", "name"]) } : {}),
    ...(source.currentClass ? { currentClass: pick(source.currentClass, ["id", "name", "campusId"]) } : {}),
    ...(source.currentSubject ? {
      currentSubject: pick(source.currentSubject, ["id", "classId", "name", "allSubjects", "unSubmitCount"]),
    } : {}),
    availableTermCount: Array.isArray(source.availableTerms) ? source.availableTerms.length : undefined,
    availableSubjectCount: Array.isArray(source.availableSubjects) ? source.availableSubjects.length : undefined,
  };
}

function compactCourse(course) {
  const source = course && typeof course === "object" ? course : {};
  const teacherNames = Array.isArray(source.teacherList)
    ? source.teacherList.map((teacher) => teacher?.userName || teacher?.name).filter(Boolean)
    : [];
  return {
    ...pick(source, ["id", "classId", "name", "color", "unSubmitCount", "allSubjects"]),
    ...(teacherNames.length ? { teacherNames } : {}),
  };
}

function compactTask(task) {
  const source = task && typeof task === "object" ? task : {};
  return pick(source, [
    "id",
    "activityId",
    "activityName",
    "title",
    "courseId",
    "courseName",
    "classId",
    "createName",
    "releaseTime",
    "endTime",
    "scoreTypeName",
    "scoreCategory",
    "homeworkType",
    "isParticipate",
    "correction",
    "lastAwcId",
    "status",
    "submitStatus",
  ]);
}

function compactDraftWriteResult(result) {
  return pick(result, [
    "saved",
    "draftId",
    "status",
    "taskId",
    "subjectName",
    "taskTitle",
    "updatedAt",
    "reviewPath",
  ]);
}

function sanitize(value, key = "", depth = 0) {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return truncateText(value);
  if (depth >= 10) return "[nested data omitted]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, key, depth + 1));
  if (typeof value !== "object") return String(value);

  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (OMITTED_KEYS.has(childKey)) continue;
    if (childKey === "context") {
      result.context = compactSession(childValue);
      continue;
    }
    if (childKey === "sourceSession") {
      result.sourceSession = compactSession(childValue);
      continue;
    }
    if (childKey === "task" && value.taskSummary) continue;
    result[childKey] = sanitize(childValue, childKey, depth + 1);
  }
  return result;
}

export function compactAgentToolResult(name, result) {
  const toolName = String(name || "");
  if (["draft_task_submission", "update_submission_draft"].includes(toolName)) {
    return compactDraftWriteResult(result);
  }
  if (["session_status", "refresh_context", "set_current_term", "set_current_subject"].includes(toolName)) {
    return compactSession(result);
  }
  if (toolName === "list_terms") {
    return {
      context: compactSession(result?.context),
      terms: Array.isArray(result?.terms) ? result.terms.map((term) => pick(term, ["id", "name", "status"])) : [],
    };
  }
  if (toolName === "list_courses") {
    return {
      context: compactSession(result?.context),
      currentTermId: result?.currentTermId || null,
      courses: Array.isArray(result?.courses) ? result.courses.map(compactCourse) : [],
    };
  }
  if (toolName === "list_tasks") {
    return {
      context: compactSession(result?.context),
      query: sanitize(result?.query || {}),
      totalRecords: result?.totalRecords ?? 0,
      pendingHomeworkList: Array.isArray(result?.pendingHomeworkList) ? result.pendingHomeworkList.map(compactTask) : [],
      unsubmittedHomeworkList: Array.isArray(result?.unsubmittedHomeworkList) ? result.unsubmittedHomeworkList.map(compactTask) : [],
      homeworkList: Array.isArray(result?.homeworkList) ? result.homeworkList.map(compactTask) : [],
    };
  }
  return sanitize(result);
}
