import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BanxuebangClient } from "../src/banxuebang-client.js";
import { DraftStore } from "../src/draft-store.js";

async function setup(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bxb-draft-delivery-"));
  const draftDir = path.join(root, "drafts");
  const store = new DraftStore(draftDir);
  await store.save({
    draftId: "draft_delivery_test",
    status: "approved",
    taskId: "task-9",
    draftText: "提交正文",
    deliveryHistory: [],
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const client = new BanxuebangClient({}, store);
  client.prepareDraftSubmission = async () => ({
    draftId: "draft_delivery_test",
    taskId: "task-9",
    classId: "task-class-4",
    draftText: "提交正文",
    mode: "submit",
    modeLabel: "提交",
    submissionId: null,
    isCorrectWork: 0,
    retainedAttachments: [],
    canSubmit: true,
    confirmationToken: "confirmed-preview",
  });

  return { client, store, draftDir };
}

test("successful delivery records the result and uses the task class", async (context) => {
  const { client, store } = await setup(context);
  let submitted;
  client.submitTaskResult = async (payload) => {
    submitted = payload;
    return { submissionId: "submission-42", result: { ok: true } };
  };

  const result = await client.submitApprovedDraft("draft_delivery_test", {
    confirmationToken: "confirmed-preview",
  });

  assert.equal(submitted.classId, "task-class-4");
  assert.equal(submitted.taskId, "task-9");
  assert.equal(submitted.remark, "提交正文");
  assert.equal(result.submitted, true);
  const saved = await store.get("draft_delivery_test");
  assert.equal(saved.status, "submitted");
  assert.equal(saved.deliveryAttempt.status, "success");
  assert.equal(saved.deliveryAttempt.submissionId, "submission-42");
  assert.equal(saved.deliveryHistory.at(-1).status, "success");
});

test("an uncertain result stays blocked after recreating the backend client", async (context) => {
  const { client, store, draftDir } = await setup(context);
  let submitCalls = 0;
  client.submitTaskResult = async () => {
    submitCalls += 1;
    const error = new Error("socket closed after request was sent");
    error.deliveryOutcomeUnknown = true;
    throw error;
  };

  await assert.rejects(
    client.submitApprovedDraft("draft_delivery_test", { confirmationToken: "confirmed-preview" }),
    { code: "delivery_unknown" },
  );
  const savedAfterFailure = await store.get("draft_delivery_test");
  assert.equal(savedAfterFailure.status, "approved");
  assert.equal(savedAfterFailure.deliveryAttempt.status, "unknown");
  assert.equal(savedAfterFailure.deliveryHistory.at(-1).status, "unknown");

  const restartedClient = new BanxuebangClient({}, new DraftStore(draftDir));
  restartedClient.prepareDraftSubmission = async () => {
    throw new Error("an unresolved delivery must be blocked before preparing again");
  };
  restartedClient.submitTaskResult = async () => {
    submitCalls += 1;
  };
  await assert.rejects(
    restartedClient.submitApprovedDraft("draft_delivery_test", { confirmationToken: "confirmed-preview" }),
    { code: "delivery_unknown" },
  );
  assert.equal(submitCalls, 1);
});

test("a definitive rejection leaves the draft approved and permits a fresh attempt", async (context) => {
  const { client, store } = await setup(context);
  let submitCalls = 0;
  client.submitTaskResult = async () => {
    submitCalls += 1;
    if (submitCalls === 1) throw new Error("明确拒绝：截止时间已过");
    return { submissionId: "submission-43", result: { ok: true } };
  };

  await assert.rejects(
    client.submitApprovedDraft("draft_delivery_test", { confirmationToken: "confirmed-preview" }),
    /明确拒绝/,
  );
  const rejected = await store.get("draft_delivery_test");
  assert.equal(rejected.status, "approved");
  assert.equal(rejected.deliveryAttempt.status, "failed");
  assert.equal(rejected.deliveryHistory.at(-1).status, "failed");

  const result = await client.submitApprovedDraft("draft_delivery_test", {
    confirmationToken: "confirmed-preview",
  });
  assert.equal(result.submitted, true);
  assert.equal(submitCalls, 2);
});

test("a stale preview cannot create a persisted or remote delivery attempt", async (context) => {
  const { client, store } = await setup(context);
  client.submitTaskResult = async () => {
    throw new Error("must not submit");
  };

  await assert.rejects(
    client.submitApprovedDraft("draft_delivery_test", { confirmationToken: "stale-preview" }),
    /发生了变化/,
  );
  const saved = await store.get("draft_delivery_test");
  assert.equal(saved.deliveryAttempt, undefined);
  assert.deepEqual(saved.deliveryHistory, []);
});

test("an in-flight attempt loaded after restart cannot submit again", async (context) => {
  const { client, store } = await setup(context);
  await store.update("draft_delivery_test", async (draft) => ({
    ...draft,
    deliveryAttempt: { id: "attempt-restarted", target: "task", status: "in_flight", startedAt: "2026-09-21T11:00:00.000Z" },
  }));
  client.prepareDraftSubmission = async () => {
    throw new Error("unresolved attempts must be blocked before fetching a preview");
  };
  client.submitTaskResult = async () => {
    throw new Error("unresolved attempts must not reach the external submit method");
  };

  await assert.rejects(
    client.submitApprovedDraft("draft_delivery_test", { confirmationToken: "confirmed-preview" }),
    { code: "delivery_unknown" },
  );
  assert.equal((await store.get("draft_delivery_test")).deliveryAttempt.status, "in_flight");
});

test("an unresolved attempt for one draft blocks another draft on the same task", async (context) => {
  const { client, store } = await setup(context);
  delete client.prepareDraftSubmission;
  await store.save({
    draftId: "draft_second_attempt",
    status: "approved",
    taskId: "task-9",
    draftText: "另一份正文",
    deliveryAttempt: { id: "attempt-unknown", target: "task", status: "unknown" },
  });
  assert.equal((await store.get("draft_second_attempt")).deliveryAttempt.status, "unknown");
  assert.equal((await store.list()).find((item) => item.draftId === "draft_second_attempt").taskId, "task-9");
  client.getTaskDetail = async () => ({
    task: {},
    taskSummary: { classId: "task-class-4" },
    taskClassId: "task-class-4",
    taskId: "task-9",
    mySubmissionList: [],
    attachments: [],
    mySubmissionAttachments: [],
  });

  const preview = await client.prepareDraftSubmission("draft_delivery_test");
  assert.equal(preview.canSubmit, false);
  assert.match(preview.reason, /上次提交的结果尚未确认/);
});

test("parallel drafts cannot submit to the same task at once", async (context) => {
  const { client, store } = await setup(context);
  await store.save({
    draftId: "draft_second_attempt",
    status: "approved",
    taskId: "task-9",
    draftText: "另一份正文",
    deliveryHistory: [],
  });
  let releaseFirst;
  const firstResult = new Promise((resolve) => { releaseFirst = resolve; });
  let notifyFirstStarted;
  const firstStarted = new Promise((resolve) => { notifyFirstStarted = resolve; });
  let submitCalls = 0;
  client.submitTaskResult = async () => {
    submitCalls += 1;
    notifyFirstStarted();
    await firstResult;
    return { submissionId: "submission-51" };
  };

  const first = client.submitApprovedDraft("draft_delivery_test", { confirmationToken: "confirmed-preview" });
  await firstStarted;
  await assert.rejects(
    client.submitApprovedDraft("draft_second_attempt", { confirmationToken: "confirmed-preview" }),
    /正在提交另一份草稿/,
  );
  assert.equal(submitCalls, 1);
  releaseFirst();
  assert.equal((await first).submitted, true);
});

test("transport failures and server errors mark the task outcome as unknown", async () => {
  const session = {
    auth: { access_token: "test-token" },
    context: { userInfo: { id: "student-1" } },
    baseUrl: "https://example.test",
  };
  for (const message of ["socket closed", "HTTP 503 /gateway/bxb/activityUser/receipt: service unavailable"]) {
    const client = new BanxuebangClient({});
    client.requireSession = async () => session;
    client.refreshContext = async () => {};
    client.request = async () => { throw new Error(message); };
    await assert.rejects(
      client.submitTaskResult({ taskId: "task-9", remark: "提交正文", classId: "task-class-4" }),
      (error) => {
        assert.equal(error.deliveryOutcomeUnknown, true);
        return true;
      },
    );
  }
});

test("a received client error is a definite rejection", async () => {
  const client = new BanxuebangClient({});
  client.requireSession = async () => ({
    auth: { access_token: "test-token" },
    context: { userInfo: { id: "student-1" } },
    baseUrl: "https://example.test",
  });
  client.refreshContext = async () => {};
  client.request = async () => { throw new Error("HTTP 400 /gateway/bxb/activityUser/receipt: invalid task"); };

  await assert.rejects(
    client.submitTaskResult({ taskId: "task-9", remark: "提交正文", classId: "task-class-4" }),
    (error) => {
      assert.equal(error.deliveryOutcomeUnknown, undefined);
      assert.match(error.message, /HTTP 400/);
      return true;
    },
  );
});
