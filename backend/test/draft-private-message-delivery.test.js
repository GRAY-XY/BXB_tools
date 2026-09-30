import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BanxuebangClient } from "../src/banxuebang-client.js";
import { DraftStore } from "../src/draft-store.js";

const contact = {
  id: "conversation-1",
  classId: "class-1",
  className: "三年级一班",
  peerId: "teacher-1",
  peerName: "王老师",
  peerType: "T",
  receiverId: "teacher-1",
  receiverType: "T",
  senderId: "student-1",
  senderType: "S",
};

async function setup(context, { draftText = "作业正文".repeat(700) } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bxb-private-message-delivery-"));
  const draftDir = path.join(root, "drafts");
  const store = new DraftStore(draftDir);
  await store.save({
    draftId: "draft_message_test",
    status: "approved",
    taskId: "task-9",
    taskTitle: "语文作业",
    subjectName: "语文",
    draftText,
    deliveryHistory: [],
  });
  context.after(() => rm(root, { recursive: true, force: true }));

  const client = new BanxuebangClient({}, store);
  client.getTaskDetail = async () => ({
    taskId: "task-9",
    task: {},
    taskSummary: { activityName: "语文作业", courseName: "语文" },
    context: { user: { name: "小明" } },
  });
  client.listPrivateMessageContacts = async () => ({ contacts: [contact] });
  return { client, store, draftDir };
}

async function prepare(client) {
  return client.prepareDraftPrivateMessage("draft_message_test", { contact });
}

test("private-message progress is persisted before and after every confirmed chunk", async (context) => {
  const { client, store } = await setup(context);
  const preview = await prepare(client);
  const observedAttempts = [];
  client.sendPrivateMessageText = async (_contact, text) => {
    const draft = await store.get("draft_message_test");
    observedAttempts.push({ status: draft.teacherMessageAttempt?.status, nextChunkIndex: draft.teacherMessageAttempt?.nextChunkIndex, text });
    return { sent: true, message: { id: `message-${observedAttempts.length}` } };
  };

  const result = await client.sendApprovedDraftPrivateMessage("draft_message_test", {
    contact,
    confirmationToken: preview.confirmationToken,
  });

  const saved = await store.get("draft_message_test");
  assert.equal(result.sent, true);
  assert.equal(result.chunkCount, preview.chunkCount);
  assert.equal(observedAttempts.length, preview.chunkCount);
  assert.ok(observedAttempts.every((attempt, index) => attempt.status === "in_flight" && attempt.nextChunkIndex === index));
  assert.equal(saved.teacherMessageAttempt.status, "success");
  assert.equal(saved.teacherMessageAttempt.confirmedMessages.length, preview.chunkCount);
  assert.equal(saved.deliveryHistory.at(-1).status, "success");
});

test("a definite chunk rejection can resume at that chunk without resending confirmed chunks", async (context) => {
  const { client, store, draftDir } = await setup(context);
  const preview = await prepare(client);
  const sentIndexes = [];
  let failSecondChunk = true;
  client.sendPrivateMessageText = async (_contact, _text) => {
    const draft = await store.get("draft_message_test");
    sentIndexes.push(draft.teacherMessageAttempt.nextChunkIndex + 1);
    if (failSecondChunk && sentIndexes.length === 2) {
      const error = new Error("老师消息发送被明确拒绝");
      error.deliveryOutcomeUnknown = false;
      throw error;
    }
    return { sent: true, message: { id: `message-${sentIndexes.length}` } };
  };

  const failed = await client.sendApprovedDraftPrivateMessage("draft_message_test", {
    contact,
    confirmationToken: preview.confirmationToken,
  });
  assert.equal(failed.sent, false);
  assert.equal(failed.failedChunkIndex, 2);
  const savedAfterFailure = await store.get("draft_message_test");
  assert.equal(savedAfterFailure.teacherMessageAttempt.status, "failed");
  assert.equal(savedAfterFailure.teacherMessageAttempt.nextChunkIndex, 1);
  assert.equal(savedAfterFailure.teacherMessageAttempt.confirmedMessages.length, 1);

  failSecondChunk = false;
  const restartedClient = new BanxuebangClient({}, new DraftStore(draftDir));
  restartedClient.getTaskDetail = client.getTaskDetail;
  restartedClient.listPrivateMessageContacts = client.listPrivateMessageContacts;
  restartedClient.sendPrivateMessageText = client.sendPrivateMessageText;
  const resumePreview = await prepare(restartedClient);
  assert.equal(resumePreview.nextChunkIndex, 1);
  assert.equal(resumePreview.canSend, true);
  const resumed = await restartedClient.sendApprovedDraftPrivateMessage("draft_message_test", {
    contact,
    confirmationToken: resumePreview.confirmationToken,
  });

  assert.equal(resumed.sent, true);
  assert.deepEqual(sentIndexes, [1, 2, 2, ...Array.from({ length: preview.chunkCount - 2 }, (_, index) => index + 3)]);
});

test("an uncertain chunk stays blocked after restart and is never automatically resent", async (context) => {
  const { client, store, draftDir } = await setup(context);
  const preview = await prepare(client);
  let sendCalls = 0;
  client.sendPrivateMessageText = async () => {
    sendCalls += 1;
    if (sendCalls === 2) {
      const error = new Error("socket closed after send");
      error.deliveryOutcomeUnknown = true;
      throw error;
    }
    return { sent: true, message: { id: "message-1" } };
  };

  const failed = await client.sendApprovedDraftPrivateMessage("draft_message_test", {
    contact,
    confirmationToken: preview.confirmationToken,
  });
  assert.equal(failed.sent, false);
  assert.equal(failed.outcomeUnknown, true);
  const saved = await store.get("draft_message_test");
  assert.equal(saved.teacherMessageAttempt.status, "unknown");
  assert.equal(saved.teacherMessageAttempt.confirmedMessages.length, 1);
  assert.equal(saved.teacherMessageAttempt.uncertainChunkIndex, 2);
  await assert.rejects(client.deleteSubmissionDraft("draft_message_test"), /尚未核对或已部分送达/);

  const restartedClient = new BanxuebangClient({}, new DraftStore(draftDir));
  restartedClient.getTaskDetail = client.getTaskDetail;
  restartedClient.listPrivateMessageContacts = client.listPrivateMessageContacts;
  restartedClient.sendPrivateMessageText = async () => { sendCalls += 1; };
  const blockedPreview = await prepare(restartedClient);
  assert.equal(blockedPreview.canSend, false);
  assert.match(blockedPreview.reason, /结果尚未确认/);
  await assert.rejects(
    restartedClient.sendApprovedDraftPrivateMessage("draft_message_test", {
      contact,
      confirmationToken: blockedPreview.confirmationToken,
    }),
    /结果尚未确认/,
  );
  assert.equal(sendCalls, 2);
});

test("a partial delivery cannot switch contact or changed message content", async (context) => {
  const { client, store } = await setup(context);
  const preview = await prepare(client);
  let sendCount = 0;
  client.sendPrivateMessageText = async () => {
    sendCount += 1;
    if (sendCount === 1) return { sent: true, message: { id: "message-1" } };
    const error = new Error("明确拒绝");
    error.deliveryOutcomeUnknown = false;
    throw error;
  };
  await client.sendApprovedDraftPrivateMessage("draft_message_test", {
    contact,
    confirmationToken: preview.confirmationToken,
  });
  const saved = await store.get("draft_message_test");
  await store.update("draft_message_test", async (draft) => ({ ...draft, draftText: `${draft.draftText} changed` }));
  const otherContact = { ...contact, id: "conversation-2", peerId: "teacher-2", peerName: "李老师", receiverId: "teacher-2" };
  client.listPrivateMessageContacts = async () => ({ contacts: [contact, otherContact] });
  const changedPreview = await client.prepareDraftPrivateMessage("draft_message_test", { contact: otherContact });

  assert.equal(saved.teacherMessageAttempt.status, "failed");
  assert.equal(changedPreview.canSend, false);
  assert.match(changedPreview.reason, /不能更换联系人或修改正文/);
});

test("parallel drafts cannot send to the same task and teacher while one attempt is in flight", async (context) => {
  const { client, store } = await setup(context, { draftText: "短正文" });
  const preview = await prepare(client);
  await store.save({
    draftId: "draft_message_second",
    status: "approved",
    taskId: "task-9",
    draftText: "另一份草稿",
    deliveryHistory: [],
  });
  let releaseFirst;
  const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
  let notifyFirstStarted;
  const firstStarted = new Promise((resolve) => { notifyFirstStarted = resolve; });
  client.sendPrivateMessageText = async () => {
    notifyFirstStarted();
    await firstResponse;
    return { sent: true, message: { id: "message-1" } };
  };

  const first = client.sendApprovedDraftPrivateMessage("draft_message_test", {
    contact,
    confirmationToken: preview.confirmationToken,
  });
  await firstStarted;
  const secondPreview = await client.prepareDraftPrivateMessage("draft_message_second", { contact });
  assert.equal(secondPreview.canSend, false);
  assert.match(secondPreview.reason, /同一 task 和联系人/);
  releaseFirst();
  assert.equal((await first).sent, true);
});

test("an unresolved task submission blocks an alternative teacher message", async (context) => {
  const { client, store } = await setup(context, { draftText: "短正文" });
  await store.update("draft_message_test", async (draft) => ({
    ...draft,
    deliveryAttempt: { id: "task-attempt-1", target: "task", status: "unknown" },
  }));

  const preview = await client.prepareDraftPrivateMessage("draft_message_test", { contact });
  assert.equal(preview.canSend, false);
  assert.match(preview.reason, /作业提交结果尚未确认/);
});

test("private-message transport failures are uncertain but a received business rejection is definite", async () => {
  const client = new BanxuebangClient({});
  client.requireSession = async () => ({ auth: { access_token: "test" } });
  client.request = async () => { throw new Error("HTTP 503 /gateway/bxb/priv-msg-content/send: unavailable"); };
  await assert.rejects(
    client.sendPrivateMessageText(contact, "消息正文"),
    (error) => error.deliveryOutcomeUnknown === true,
  );

  client.request = async () => ({ code: "REJECTED", msg: "recipient cannot receive messages" });
  await assert.rejects(
    client.sendPrivateMessageText(contact, "消息正文"),
    (error) => error.deliveryOutcomeUnknown === false,
  );
});

test("a local checkpoint failure after remote acceptance blocks resend but retains the confirmed chunk", async (context) => {
  const { client, store, draftDir } = await setup(context, { draftText: "短正文" });
  const preview = await prepare(client);
  const update = store.update.bind(store);
  let failNextUpdate = false;
  store.update = async (...args) => {
    if (failNextUpdate) {
      failNextUpdate = false;
      throw new Error("local disk write failed");
    }
    return update(...args);
  };
  let sendCalls = 0;
  client.sendPrivateMessageText = async () => {
    sendCalls += 1;
    failNextUpdate = true;
    return { sent: true, message: { id: "confirmed-remotely" } };
  };

  const result = await client.sendApprovedDraftPrivateMessage("draft_message_test", {
    contact,
    confirmationToken: preview.confirmationToken,
  });
  assert.equal(result.sent, false);
  assert.equal(result.outcomeUnknown, true);
  assert.equal(result.remoteAccepted, true);
  const saved = await store.get("draft_message_test");
  assert.equal(saved.teacherMessageAttempt.status, "unknown");
  assert.equal(saved.teacherMessageAttempt.confirmedMessages.length, 1);
  assert.equal(saved.teacherMessageAttempt.nextChunkIndex, 1);
  assert.equal(saved.teacherMessageAttempt.uncertainChunkIndex, null);

  const restartedClient = new BanxuebangClient({}, new DraftStore(draftDir));
  restartedClient.getTaskDetail = client.getTaskDetail;
  restartedClient.listPrivateMessageContacts = client.listPrivateMessageContacts;
  restartedClient.sendPrivateMessageText = async () => { sendCalls += 1; };
  const blocked = await prepare(restartedClient);
  assert.equal(blocked.canSend, false);
  assert.equal(sendCalls, 1);
});
