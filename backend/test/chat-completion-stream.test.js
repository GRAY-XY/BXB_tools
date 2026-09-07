import assert from "node:assert/strict";
import test from "node:test";
import {
  readChatCompletionResponse,
  requestChatCompletionWithRecovery,
} from "../src/chat-completion-stream.js";

function sseResponse(events) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function interruptedSseResponse(events, message = "terminated") {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(encoder.encode(events[index]));
        index += 1;
        return;
      }
      controller.error(new Error(message));
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("streaming chat response publishes cumulative text", async () => {
  const received = [];
  const response = sseResponse([
    'data: {"choices":[{"delta":{"content":"正在"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"回答"},"finish_reason":"stop"}],"usage":{"prompt_tokens":12}}\n\n',
    "data: [DONE]\n\n",
  ]);

  const result = await readChatCompletionResponse(response, { onText: (content) => received.push(content) });
  assert.equal(result.ok, true);
  assert.deepEqual(received, ["正在", "正在回答"]);
  assert.equal(result.payload.choices[0].message.content, "正在回答");
  assert.equal(result.payload.usage.prompt_tokens, 12);
});

test("streaming chat response reassembles fragmented tool calls", async () => {
  const response = sseResponse([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"list_","arguments":"{\\"status\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"submission_drafts","arguments":"\\"all\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
    "data: [DONE]\n\n",
  ]);

  const result = await readChatCompletionResponse(response);
  const call = result.payload.choices[0].message.tool_calls[0];
  assert.equal(call.id, "call_1");
  assert.equal(call.function.name, "list_submission_drafts");
  assert.deepEqual(JSON.parse(call.function.arguments), { status: "all" });
});

test("JSON chat response remains supported as a compatibility fallback", async () => {
  const response = new Response(JSON.stringify({ choices: [{ message: { content: "fallback" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const received = [];
  const result = await readChatCompletionResponse(response, { onText: (content) => received.push(content) });
  assert.equal(result.payload.choices[0].message.content, "fallback");
  assert.deepEqual(received, ["fallback"]);
});

test("stream response is accepted when the socket closes after a finish reason", async () => {
  const response = interruptedSseResponse([
    'data: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\n\n',
  ]);

  const result = await readChatCompletionResponse(response);
  assert.equal(result.ok, true);
  assert.equal(result.payload.choices[0].message.content, "完成");
  assert.equal(result.payload.choices[0].finish_reason, "stop");
});

test("stream interruption reconnects once before returning the completed response", async () => {
  const requests = [];
  const phases = [];
  const fetchImpl = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) {
      return interruptedSseResponse(['data: {"choices":[{"delta":{"content":"部分"}}]}\n\n']);
    }
    return sseResponse([
      'data: {"choices":[{"delta":{"content":"完整回答"},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);
  };

  const result = await requestChatCompletionWithRecovery({
    fetchImpl,
    url: "https://example.test/chat/completions",
    headers: { "content-type": "application/json" },
    payload: { model: "test", messages: [] },
    recoveryDelayMs: 0,
    onRecovery: ({ phase }) => phases.push(phase),
  });

  assert.equal(result.payload.choices[0].message.content, "完整回答");
  assert.deepEqual(requests.map((request) => request.stream), [true, true]);
  assert.deepEqual(phases, ["retry"]);
});

test("repeated stream interruptions fall back to a complete JSON response", async () => {
  const requests = [];
  const phases = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    if (request.stream) {
      return interruptedSseResponse(['data: {"choices":[{"delta":{"content":"部分"}}]}\n\n']);
    }
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "完整兜底回答" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await requestChatCompletionWithRecovery({
    fetchImpl,
    url: "https://example.test/chat/completions",
    headers: { "content-type": "application/json" },
    payload: { model: "test", messages: [] },
    recoveryDelayMs: 0,
    onRecovery: ({ phase }) => phases.push(phase),
  });

  assert.equal(result.payload.choices[0].message.content, "完整兜底回答");
  assert.deepEqual(requests.map((request) => request.stream), [true, true, false]);
  assert.deepEqual(phases, ["retry", "fallback"]);
});

test("non-transient stream errors are not retried", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return sseResponse(["data: not-json\n\n"]);
  };

  await assert.rejects(() => requestChatCompletionWithRecovery({
    fetchImpl,
    url: "https://example.test/chat/completions",
    payload: { model: "test", messages: [] },
    recoveryDelayMs: 0,
  }), SyntaxError);
  assert.equal(calls, 1);
});
