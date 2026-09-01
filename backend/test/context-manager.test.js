import test from "node:test";
import assert from "node:assert/strict";
import {
  contextBudget,
  estimateMessagesTokens,
  normalizeContextState,
  splitIntoRounds,
  splitRecentRounds,
} from "../src/context-manager.js";

test("token estimation counts Chinese conservatively and includes tools", () => {
  const messages = [{ role: "user", content: "你好 world" }];
  assert.ok(estimateMessagesTokens(messages) >= 8);
  assert.ok(estimateMessagesTokens(messages, [{ type: "function", function: { name: "demo" } }]) > estimateMessagesTokens(messages));
});

test("context budget reserves output and targets half the window", () => {
  const budget = contextBudget(32000);
  assert.equal(budget.limit, 32000);
  assert.equal(budget.triggerTokens, 24000);
  assert.equal(budget.targetTokens, 16000);
  assert.ok(budget.outputReserve >= 1024);
});

test("round splitting preserves complete user assistant groups", () => {
  const messages = [
    { role: "system", content: "system" },
    { role: "user", content: "one" },
    { role: "assistant", content: "answer one" },
    { role: "user", content: "two" },
    { role: "assistant", content: "answer two" },
  ];
  const { leading, rounds } = splitIntoRounds(messages);
  assert.equal(leading.length, 1);
  assert.equal(rounds.length, 2);
  assert.equal(rounds[1][0].content, "two");
});

test("recent split always keeps the latest complete round", () => {
  const rounds = Array.from({ length: 5 }, (_, index) => [
    { role: "user", content: `question ${index}` },
    { role: "assistant", content: `answer ${index}` },
  ]);
  const result = splitRecentRounds(rounds, estimateMessagesTokens(rounds.flat()), 0.15);
  assert.ok(result.older.length >= 1);
  assert.ok(result.recent.length >= 1);
  assert.equal(result.recent.at(-1)[0].content, "question 4");
});

test("context state migrates missing fields", () => {
  const state = normalizeContextState({ summary: " previous ", compactionCount: "2" });
  assert.equal(state.version, 2);
  assert.equal(state.summary, "previous");
  assert.equal(state.compactionCount, 2);
  assert.equal(state.estimatedTokens, 0);
});
