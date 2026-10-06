import assert from "node:assert/strict";
import test from "node:test";
import { AcademicContextCoordinator } from "../src/academic-context-coordinator.js";

test("a term change is rejected while an older account operation is running", async () => {
  const coordinator = new AcademicContextCoordinator();
  let release;
  const operation = coordinator.runOperation(() => new Promise((resolve) => { release = resolve; }));
  let selectedTerm = "A";
  await assert.rejects(coordinator.runSwitch(async () => { selectedTerm = "B"; }), { code: "academic_context_busy" });
  assert.equal(selectedTerm, "A");
  release();
  await operation;
  await coordinator.runSwitch(async () => { selectedTerm = "B"; });
  assert.equal(selectedTerm, "B");
});

test("new account operations and duplicate switches cannot enter a pending term change", async () => {
  const coordinator = new AcademicContextCoordinator();
  let release;
  const switching = coordinator.runSwitch(() => new Promise((resolve) => { release = resolve; }));
  let calls = 0;
  await assert.rejects(coordinator.runOperation(async () => { calls += 1; }), { code: "academic_context_busy" });
  await assert.rejects(coordinator.runSwitch(async () => { calls += 1; }), { code: "academic_context_busy" });
  assert.equal(calls, 0);
  release();
  await switching;
  await coordinator.runOperation(async () => { calls += 1; });
  assert.equal(calls, 1);
});

test("failed operations and switches release the academic context guard", async () => {
  const coordinator = new AcademicContextCoordinator();
  await assert.rejects(coordinator.runOperation(async () => { throw new Error("read failed"); }), /read failed/);
  await assert.rejects(coordinator.runSwitch(async () => { throw new Error("switch failed"); }), /switch failed/);
  assert.equal(await coordinator.runSwitch(async () => "Term B"), "Term B");
  assert.equal(await coordinator.runOperation(async () => "Course B"), "Course B");
});
