import assert from "node:assert/strict";
import test from "node:test";
import { BanxuebangClient } from "../src/banxuebang-client.js";

test("home pending count paginates all current-term courses and removes duplicate tasks", async () => {
  const session = {
    auth: { access_token: "test-token" },
    context: {
      userInfo: { id: "student-1" },
      currTermId: "term-1",
      subjectList: [
        { id: "course-a", classId: "class-1", cnName: "Course A" },
        { id: "course-b", classId: "class-1", cnName: "Course B" },
      ],
    },
  };
  const client = new BanxuebangClient({ load: async () => session });
  client.refreshContext = async () => client.summarizeSession(session);

  const calls = [];
  client.queryHomeworkForSubject = async (_session, subject, options) => {
    calls.push({ subjectId: subject.id, ...options });
    if (subject.id === "course-a" && options.page === 1) {
      return {
        totalRecords: 3,
        pendingHomeworkList: [{ id: "task-1" }, { activityId: "task-2" }],
      };
    }
    if (subject.id === "course-a" && options.page === 2) {
      return { totalRecords: 3, pendingHomeworkList: [{ id: "task-3" }] };
    }
    return {
      totalRecords: 2,
      pendingHomeworkList: [{ id: "task-2" }, { taskId: "task-4" }],
    };
  };

  const result = await client.getPendingHomeworkSummary({ pageSize: 2 });

  assert.equal(result.pendingTaskCount, 4);
  assert.equal(result.reportedTotalRecords, 5);
  assert.equal(result.courseCount, 2);
  assert.equal(result.currentTermId, "term-1");
  assert.deepEqual(calls.sort((left, right) => `${left.subjectId}:${left.page}`.localeCompare(`${right.subjectId}:${right.page}`)), [
    { subjectId: "course-a", listType: "pending", page: 1, size: 2 },
    { subjectId: "course-a", listType: "pending", page: 2, size: 2 },
    { subjectId: "course-b", listType: "pending", page: 1, size: 2 },
  ]);
});
