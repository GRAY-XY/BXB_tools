import readline from "node:readline";

let term = "1";
let failSwitch = "";
let failStatus = false;
let holdCourses = false;
let holdDetail = false;
const held = new Map();
const watchers = new Map();
const send = (id, result) => process.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
const session = () => ({
  ready: true, user: { id: "student-1", name: "Student" }, currentTermId: term,
  currentClass: { id: "class-1", name: "Class" },
  availableTerms: [{ id: "1", name: "Term A", status: true }, { id: "2", name: "Term B", status: false }],
  availableSubjects: [{ id: `course-${term}`, classId: "class-1", name: `Course ${term}`, unSubmitCount: 99 }],
});
function suspend(kind, id, result) {
  held.set(kind, { id, result });
  for (const watcher of watchers.get(kind) || []) send(watcher, {});
  watchers.delete(kind);
}
const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const { id, method, params = {} } = JSON.parse(line);
  try {
    if (method === "app.info") send(id, { version: "fixture", platform: "darwin", isPackaged: false });
    else if (method === "modelConfig.load") send(id, {});
    else if (method === "session.status" || method === "session.refresh") {
      if (failStatus) throw new Error("Cannot read fixture session");
      send(id, session());
    } else if (method === "home.pendingCount") send(id, { pendingTaskCount: term === "1" ? 4 : 2, currentTermId: term });
    else if (method === "session.switchTerm") {
      if (failSwitch === "rejected") throw new Error("Fixture switch rejected");
      term = params.termId;
      if (failSwitch) {
        if (failSwitch === "unknown") failStatus = true;
        throw new Error("Fixture response interrupted");
      }
      send(id, session());
    } else if (method === "tool.call" && params.name === "list_terms") send(id, { context: session(), terms: session().availableTerms });
    else if (method === "tool.call" && params.name === "list_courses") {
      const result = { context: session(), courses: [{ id: "__all__", name: "全部课程", allSubjects: true }, { id: `course-${term}`, classId: "class-1", name: `Course ${term}` }] };
      if (holdCourses) { holdCourses = false; suspend("courses", id, result); }
      else send(id, result);
    } else if (method === "tool.call" && params.name === "list_tasks") send(id, { tasks: [{ id: `task-${term}`, name: `Task ${term}` }] });
    else if (method === "tool.call" && params.name === "read_task_content") {
      const result = { taskId: params.args.task_id, content: "Fixture content" };
      if (holdDetail) { holdDetail = false; suspend("detail", id, result); }
      else send(id, result);
    } else if (method === "tool.call" && params.name === "get_submission_draft") send(id, {
      draft: { draftId: "draft-1", status: "approved", taskId: "task-1", draftText: "Saved draft", summary: "Saved summary" },
    });
    else if (method === "tool.call" && params.name === "prepare_draft_submission") send(id, {
      draftId: "draft-1", taskId: "task-1", confirmationToken: "fixture-token", canSubmit: true,
    });
    else if (method === "fixture.failSwitch") { failSwitch = params.mode; send(id, {}); }
    else if (method === "fixture.recover") { failSwitch = ""; failStatus = false; send(id, {}); }
    else if (method === "fixture.forceTerm") { term = params.termId; send(id, {}); }
    else if (method === "fixture.hold") {
      if (params.kind === "courses") holdCourses = true;
      else holdDetail = true;
      send(id, {});
    } else if (method === "fixture.awaitHeld") {
      if (held.has(params.kind)) send(id, {});
      else watchers.set(params.kind, [...(watchers.get(params.kind) || []), id]);
    } else if (method === "fixture.release") {
      const response = held.get(params.kind);
      held.delete(params.kind);
      if (response) send(response.id, response.result);
      send(id, {});
    } else throw new Error(`Unexpected fixture method: ${method}`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ id, ok: false, error: { message: error.message } })}\n`);
  }
});
reader.on("close", () => process.exit(0));
