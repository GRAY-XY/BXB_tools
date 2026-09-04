import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const bridgePath = path.join(repoRoot, "backend", "bridge", "winui-backend.js");
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function startMockModel() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(payload);
      const content = payload.model === "vision-model" ? "图片中有一张蓝色卡片。" : "已读取图片。";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function provider(id, name, baseUrl, modelName) {
  return { id, type: "openai", name, apiKey: "test-key", baseUrl, modelName };
}

async function runImageChat(modelConfig) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-image-input-"));
  const appData = path.join(root, "AppData", "Roaming");
  const userDataRoot = path.join(appData, "bxb-homework-electron");
  const workspace = path.join(userDataRoot, ".banxuebang", "workspace");
  const imagePath = path.join(workspace, "pasted", "sample.png");
  await fs.mkdir(path.dirname(imagePath), { recursive: true });
  await fs.writeFile(imagePath, onePixelPng);
  await fs.writeFile(path.join(userDataRoot, "model-config.json"), JSON.stringify(modelConfig, null, 2));

  const child = spawn(process.execPath, [bridgePath], {
    cwd: repoRoot,
    env: { ...process.env, APPDATA: appData },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const requestLine = `${JSON.stringify({
    id: "image-test",
    method: "agent:chat",
    params: {
      text: "请说明图片内容",
      conversationId: "image-test-conversation",
      userMessageId: "user-image-test",
      assistantMessageId: "assistant-image-test",
      attachments: [{ path: imagePath }],
    },
  })}\n`;

  const final = await new Promise((resolve, reject) => {
    let pending = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`bridge timed out: ${stderr.join("")}`));
    }, 15000);
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines.filter(Boolean)) {
        const response = JSON.parse(line);
        if (response.id === "image-test" && response.event !== "progress") {
          clearTimeout(timer);
          resolve(response);
        }
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", () => {
      if (pending) stdout.push(pending);
    });
    child.stdin.write(requestLine);
  });

  try {
    assert.equal(final?.ok, true, final?.error?.message || stderr.join(""));
    assert.equal(final.result.message, "已读取图片。");
    const conversationText = await fs.readFile(path.join(userDataRoot, "agent-conversations.json"), "utf8");
    return { final, imagePath, conversationText };
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("close", resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}

function lastUserMessage(request) {
  return [...request.messages].reverse().find((message) => message.role === "user");
}

test("disabled image transcription sends pasted images directly to the chat model", async () => {
  const mock = await startMockModel();
  try {
    const chat = provider("chat", "Chat", mock.baseUrl, "chat-model");
    const result = await runImageChat({
      activeProviderId: chat.id,
      providers: [chat],
      modelRoles: {
        chat: { enabled: true, activeProviderId: chat.id, providers: [chat] },
        image_caption: { enabled: false, activeProviderId: "", providers: [] },
      },
    });

    assert.equal(mock.requests.length, 1);
    const content = lastUserMessage(mock.requests[0]).content;
    assert.ok(Array.isArray(content));
    assert.match(content.find((item) => item.type === "text").text, /pasted\/sample\.png/);
    assert.match(content.find((item) => item.type === "image_url").image_url.url, /^data:image\/png;base64,/);
    assert.match(result.final.result.conversation.title, /请说明图片内容/);
    assert.equal(result.final.result.steps[0].title, "附带图片将由主模型直接读取");
    assert.ok(result.final.result.steps.some((step) => step.title === "正在分析请求"));
    assert.equal(result.final.result.steps.at(-1).title, "模型已生成最终回答");
    assert.doesNotMatch(result.conversationText, /data:image\/png;base64/);
    assert.match(result.conversationText, /sample\.png/);
  } finally {
    await mock.close();
  }
});

test("enabled image transcription captions first and sends only the caption to chat", async () => {
  const mock = await startMockModel();
  try {
    const chat = provider("chat", "Chat", mock.baseUrl, "chat-model");
    const vision = provider("vision", "Vision", mock.baseUrl, "vision-model");
    const result = await runImageChat({
      activeProviderId: chat.id,
      providers: [chat],
      modelRoles: {
        chat: { enabled: true, activeProviderId: chat.id, providers: [chat] },
        image_caption: { enabled: true, activeProviderId: vision.id, providers: [vision] },
      },
    });

    assert.equal(mock.requests.length, 2);
    const visionRequest = mock.requests.find((request) => request.model === "vision-model");
    const chatRequest = mock.requests.find((request) => request.model === "chat-model");
    assert.ok(visionRequest);
    assert.ok(chatRequest);
    assert.ok(lastUserMessage(visionRequest).content.some((item) => item.type === "image_url"));
    assert.match(visionRequest.messages[0].content, /忠实提取/);
    assert.equal(typeof lastUserMessage(chatRequest).content, "string");
    assert.match(lastUserMessage(chatRequest).content, /图片转述结果/);
    assert.match(lastUserMessage(chatRequest).content, /蓝色卡片/);
    assert.doesNotMatch(JSON.stringify(chatRequest), /data:image\/png;base64/);
    assert.doesNotMatch(result.conversationText, /data:image\/png;base64/);
    assert.match(result.conversationText, /蓝色卡片/);
  } finally {
    await mock.close();
  }
});
