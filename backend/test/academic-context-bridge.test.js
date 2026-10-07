import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { SessionStore } from "../src/session-store.js";

test("native bridge serializes term switching against real course reads and session mutations", { timeout: 15000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-academic-bridge-"));
  const sessionFile = path.join(root, "bxb-homework-electron", ".banxuebang", "session.json");
  let holdNextCourses = false;
  let heldResponse;
  let failingCourseRequests = -1;
  let onHeld;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    let data;
    if (url.pathname.endsWith("/oauth/token")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ access_token: "refreshed-fixture-token", refresh_token: "fixture-refresh" }));
      return;
    }
    if (url.pathname.endsWith("/course-list") && url.searchParams.get("termId") === "2" && failingCourseRequests >= 0) {
      response.writeHead(failingCourseRequests++ === 0 ? 401 : 503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "fixture course failure" }));
      return;
    }
    if (url.pathname.endsWith("/class")) data = [{ id: "class-1", className: "Class" }];
    else if (url.pathname.endsWith("/term")) data = [{ id: 1, name: "Term A", status: true }, { id: 2, name: "Term B", status: false }];
    else if (url.pathname.endsWith("/course-list")) {
      data = [{ id: "course-" + url.searchParams.get("termId"), classId: "class-1", cnName: "Course " + url.searchParams.get("termId") }];
      if (holdNextCourses) {
        holdNextCourses = false;
        heldResponse = () => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data }));
        };
        onHeld();
        return;
      }
    } else { response.writeHead(404); response.end(); return; }
    assert.equal(request.method, "GET");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const store = new SessionStore(sessionFile);
  await store.save({
    baseUrl: "http://127.0.0.1:" + server.address().port,
    auth: { access_token: "fixture-token", refresh_token: "fixture-refresh" },
    context: { userInfo: { id: "student-1" }, currTermId: 1, curClass: { id: "class-1" } },
    storage: { currTermId: "1" },
  });
  const child = spawn(process.execPath, ["backend/bridge/winui-backend.js"], {
    env: { ...process.env, APPDATA: root, BXB_MACOS_NATIVE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const replies = new Map();
  let sequence = 0;
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const response = JSON.parse(line);
    if (response.event !== "progress") replies.get(response.id)?.(response);
  });
  const request = (method, params = {}) => new Promise((resolve) => {
    const id = String(++sequence);
    replies.set(id, (result) => { replies.delete(id); resolve(result); });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  t.after(async () => {
    child.kill();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const hold = () => {
    holdNextCourses = true;
    return new Promise((resolve) => { onHeld = resolve; });
  };
  let started = hold();
  const oldRead = request("tool.call", { name: "list_courses" });
  await started;
  const blocked = await request("session.switchTerm", { termId: "2" });
  assert.equal(blocked.ok, false, stderr);
  assert.equal(blocked.error.code, "academic_context_busy");
  assert.equal(String((await store.load()).context.currTermId), "1");
  heldResponse();
  assert.equal((await oldRead).ok, true);

  started = hold();
  const switching = request("session.switchTerm", { termId: "2" });
  await started;
  for (const method of ["session.switchTerm", "session.logout", "session.status", "session.refresh", "home.pendingCount"]) {
    const result = await request(method, { termId: "2" });
    assert.equal(result.ok, false, method);
    assert.equal(result.error.code, "academic_context_busy", method);
  }
  heldResponse();
  const switched = await switching;
  assert.equal(switched.ok, true, stderr);
  assert.equal(String(switched.result.currentTermId), "2");
  const courses = await request("tool.call", { name: "list_courses" });
  assert.equal(courses.ok, true, stderr);
  assert.equal(courses.result.courses.at(-1).name, "Course 2");
  assert.equal(String((await store.load()).context.currTermId), "2");

  assert.equal((await request("session.switchTerm", { termId: "1" })).ok, true);
  failingCourseRequests = 0;
  const failed = await request("session.switchTerm", { termId: "2" });
  assert.equal(failed.ok, false);
  const saved = await store.load();
  assert.equal(saved.auth.access_token, "refreshed-fixture-token");
  assert.equal(String(saved.context.currTermId), "1", "Token refresh must not publish a half-switched term");
  assert.equal(saved.context.subjectList[0].cnName, "Course 1");
});
