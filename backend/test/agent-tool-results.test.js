import assert from "node:assert/strict";
import test from "node:test";
import { compactAgentToolResult } from "../src/agent-tool-results.js";

const context = {
  ready: true,
  baseUrl: "https://student.example",
  sessionFile: "C:/private/session.json",
  accessToken: "masked-access-token",
  refreshToken: "masked-refresh-token",
  currentTermId: "term-1",
  user: { id: "user-1", name: "Student", loginName: "private@example.com" },
  currentClass: { id: "class-1", name: "Class 1", campusId: "campus-1" },
  currentSubject: { id: "physics", classId: "class-1", name: "Physics", unSubmitCount: 2 },
  availableTerms: [{ id: "term-1" }, { id: "term-2" }],
  availableSubjects: [{ id: "physics" }],
};

test("session tool results keep current context without credentials or full lists", () => {
  const result = compactAgentToolResult("session_status", context);
  assert.equal(result.ready, true);
  assert.equal(result.currentSubject.name, "Physics");
  assert.equal(result.availableTermCount, 2);
  assert.equal(result.availableSubjectCount, 1);
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /accessToken|refreshToken|sessionFile|private@example/);
  assert.doesNotMatch(text, /availableTerms|availableSubjects/);
});

test("task list results remove duplicate course data and compact task records", () => {
  const result = compactAgentToolResult("list_tasks", {
    context,
    query: { page: 1, size: 10 },
    totalRecords: 1,
    homeworkList: [{ id: "task-1", activityName: "Test", courseName: "Physics", endTime: "tomorrow", activityContent: "large duplicate body" }],
    pendingHomeworkList: [],
    unsubmittedHomeworkList: [],
    courseResults: [{ duplicated: true }],
  });
  assert.equal(result.homeworkList[0].activityName, "Test");
  assert.equal(result.homeworkList[0].courseName, "Physics");
  assert.equal(result.homeworkList[0].activityContent, undefined);
  assert.equal(result.courseResults, undefined);
  assert.equal(result.context.currentTermId, "term-1");
});

test("general tool results omit raw duplicates while preserving readable text", () => {
  const result = compactAgentToolResult("read_task_attachment", {
    context,
    read: { text: "attachment text", raw: { duplicate: true } },
    download: { path: "C:/workspace/file.pdf", dataUrl: "data:application/pdf;base64,secret" },
  });
  assert.equal(result.read.text, "attachment text");
  assert.equal(result.read.raw, undefined);
  assert.equal(result.download.path, "C:/workspace/file.pdf");
  assert.equal(result.download.dataUrl, undefined);
});

test("draft writes do not echo the full draft back to the model", () => {
  const result = compactAgentToolResult("draft_task_submission", {
    saved: true,
    draftId: "draft-1",
    status: "pending_review",
    taskId: "task-1",
    reviewPath: "C:/drafts/draft-1.json",
    draft: { draftText: "already known body", sourceSession: context },
  });
  assert.deepEqual(result, {
    saved: true,
    draftId: "draft-1",
    status: "pending_review",
    taskId: "task-1",
    reviewPath: "C:/drafts/draft-1.json",
  });
});

test("reading a draft preserves its body but compacts the captured session", () => {
  const result = compactAgentToolResult("get_submission_draft", {
    draftDirectory: "C:/drafts",
    draft: { draftId: "draft-1", draftText: "body to revise", sourceSession: context },
  });
  assert.equal(result.draft.draftText, "body to revise");
  assert.equal(result.draft.sourceSession.currentSubject.name, "Physics");
  assert.equal(result.draft.sourceSession.availableTermCount, 2);
  assert.doesNotMatch(JSON.stringify(result), /accessToken|refreshToken|sessionFile/);
});
