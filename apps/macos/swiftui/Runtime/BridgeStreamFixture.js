import readline from "node:readline";

const reader = readline.createInterface({ input: process.stdin });
const waiting = new Map();
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

reader.on("line", (line) => {
  const request = JSON.parse(line);
  const { id, method } = request;
  if (method === "probe.stream") {
    send({ id, event: "progress", result: { type: "agent-step", messageId: "m1", conversationId: "c1", steps: [{ kind: "llm", title: "Thinking" }] } });
    send({ id, event: "progress", result: { type: "agent-text", messageId: "m1", conversationId: "c1", text: "Hello" } });
    send({ id, event: "progress", result: { type: "agent-text", messageId: "m1", conversationId: "c1", text: "Hello world" } });
    send({ id, ok: true, result: { message: "Hello world" } });
  } else if (method === "probe.wait") {
    waiting.set(id, request);
  } else if (method === "probe.error") {
    send({ id, ok: false, error: { code: "FIXTURE_ERROR", message: "Expected failure" } });
  } else if (method === "probe.exit") {
    send({ id, event: "progress", result: { type: "agent-text", messageId: "m2", conversationId: "c1", text: "Partial" } });
    setImmediate(() => process.exit(17));
  } else if (method === "agent.cancel") {
    send({ id, ok: true, result: { cancellationRequested: true } });
    for (const pending of waiting.values()) {
      send({ id: pending.id, ok: true, result: { canceled: true, message: "Stopped" } });
    }
    waiting.clear();
  } else {
    send({ id, ok: false, error: { message: "Unknown fixture method" } });
  }
});
