import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BanxuebangClient } from "../src/banxuebang-client.js";
import { SessionStore } from "../src/session-store.js";

async function setup(t, { failNewCourses = false, removeTarget = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bxb-term-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SessionStore(path.join(root, "session.json"));
  await store.save({
    auth: { access_token: "fixture-token" },
    context: {
      userInfo: { id: "student-1" },
      currTermId: 1,
      curClass: { id: "class-1" },
      curSubject: { id: "shared-course", classId: "class-1", cnName: "First term" },
      subjectList: [{ id: "shared-course", classId: "class-1", cnName: "First term" }],
      termList: [{ id: 1, name: "Term A", status: true }, { id: 2, name: "Term B", status: false }],
    },
    storage: { currTermId: "1" },
  });
  const client = new BanxuebangClient(store);
  let termReads = 0;
  const requests = [];
  // Replace only the remote HTTP boundary. Refresh, selection and persistence stay real.
  client.request = async (_session, method, endpoint, options = {}) => {
    requests.push({ method, endpoint, ...options });
    assert.equal(method, "GET", "term switching must never write to the remote account");
    if (endpoint.endsWith("/class")) return { data: [{ id: "class-1", className: "Class" }] };
    if (endpoint.endsWith("/term")) {
      termReads += 1;
      return { data: removeTarget && termReads > 1
        ? [{ id: 1, name: "Term A", status: true }]
        : [{ id: 1, name: "Term A", status: true }, { id: 2, name: "Term B", status: false }] };
    }
    if (endpoint.endsWith("/course-list")) {
      if (String(options.params.termId) === "2" && failNewCourses) throw new Error("course refresh failed");
      return { data: [{ id: "shared-course", classId: "class-1", cnName: String(options.params.termId) === "2" ? "Second term" : "First term" }] };
    }
    throw new Error(`Unexpected remote request: ${endpoint}`);
  };
  return { store, client, requests };
}

test("switching terms persists the new courses and resets the page course context", async (t) => {
  const { store, client } = await setup(t);
  const result = await client.setCurrentTerm("2");
  assert.equal(String(result.currentTermId), "2");
  assert.deepEqual(result.availableSubjects.map((course) => course.name), ["Second term"]);
  assert.equal(result.currentSubject.allSubjects, true);
  const saved = await store.load();
  assert.equal(String(saved.context.currTermId), "2");
  assert.equal(saved.storage.currTermId, "2");
  assert.deepEqual(saved.context.subjectList.map((course) => course.cnName), ["Second term"]);
  // Reloading through a new client must keep the user's selection, not the default term.
  const reopened = new BanxuebangClient(store);
  reopened.request = client.request;
  assert.equal(String((await reopened.refreshContext()).currentTermId), "2");
});

test("a failed new-term course refresh leaves the persisted old term and courses consistent", async (t) => {
  const { store, client } = await setup(t, { failNewCourses: true });
  await assert.rejects(client.setCurrentTerm("2"), /course refresh failed/);
  const saved = await store.load();
  assert.equal(String(saved.context.currTermId), "1");
  assert.equal(saved.storage.currTermId, "1");
  assert.deepEqual(saved.context.subjectList.map((course) => course.cnName), ["First term"]);
  assert.equal(saved.context.curSubject.cnName, "First term");
});

test("a target that disappears during switching does not silently choose another term", async (t) => {
  const { store, client } = await setup(t, { removeTarget: true });
  await assert.rejects(client.setCurrentTerm("2"), /学期|Term/);
  assert.equal(String((await store.load()).context.currTermId), "1");
});

test("an invalid target leaves the current academic context intact", async (t) => {
  const { store, client } = await setup(t);
  await assert.rejects(client.setCurrentTerm("missing"), /not found/);
  assert.equal(String((await store.load()).context.currTermId), "1");
});

test("refresh retains the selected term even when another term has the current flag", async (t) => {
  const { client } = await setup(t);
  await client.setCurrentTerm(2);
  const listed = await client.listTerms();
  assert.equal(String(listed.context.currentTermId), "2");
  assert.deepEqual(listed.terms.map((term) => term.id), ["1", "2"]);
});
