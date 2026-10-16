import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { normalizeModelImage } from "../src/model-image.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const bridgePath = path.join(repoRoot, "backend", "bridge", "winui-backend.js");
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function twoPixelBmp() {
  const buffer = Buffer.alloc(62);
  buffer.write("BM");
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(2, 18);
  buffer.writeInt32LE(1, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(8, 34);
  buffer.set([0, 0, 255, 0, 255, 0, 0, 0], 54);
  return buffer;
}

async function assertRedGreenPng(dataUrl) {
  assert.match(dataUrl, /^data:image\/png;base64,/);
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const image = await loadImage(bytes);
  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
  const context = createCanvas(2, 1).getContext("2d");
  context.drawImage(image, 0, 0);
  assert.deepEqual([...context.getImageData(0, 0, 2, 1).data], [255, 0, 0, 255, 0, 255, 0, 255]);
}

async function startMockModel() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(payload);
      if (payload.model === "vision-model") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "图片中有一张蓝色卡片。" } }] }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"choices":[{"delta":{"content":"已读取"}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"图片。"},"finish_reason":"stop"}]}\n\n');
      response.end("data: [DONE]\n\n");
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

async function runImageChat(modelConfig, { fileName = "sample.png", bytes = onePixelPng, pasteMimeType } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-image-input-"));
  const appData = path.join(root, "AppData", "Roaming");
  const userDataRoot = path.join(appData, "bxb-homework-electron");
  const workspace = path.join(userDataRoot, ".banxuebang", "workspace");
  let imagePath = path.join(workspace, "pasted", fileName);
  await fs.mkdir(path.dirname(imagePath), { recursive: true });
  if (!pasteMimeType) await fs.writeFile(imagePath, bytes);
  await fs.writeFile(path.join(userDataRoot, "model-config.json"), JSON.stringify(modelConfig, null, 2));

  const child = spawn(process.execPath, [bridgePath], {
    cwd: repoRoot,
    env: { ...process.env, APPDATA: appData },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  const stderr = [];
  const progress = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const replies = new Map();
  let sequence = 0;
  child.once("close", (code) => {
    for (const reply of [...replies.values()]) {
      reply({ ok: false, error: { message: `bridge exited (${code}): ${stderr.join("")}` } });
    }
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const response = JSON.parse(line);
    if (response.event === "progress") progress.push(response.result);
    else replies.get(response.id)?.(response);
  });
  const invoke = (method, params) => new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => {
      replies.delete(id);
      reject(new Error(`bridge timed out: ${stderr.join("")}`));
    }, 15000);
    replies.set(id, (response) => {
      clearTimeout(timer);
      replies.delete(id);
      resolve(response);
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });

  try {
    let saved;
    if (pasteMimeType) {
      const pasted = await invoke("workspace:save-pastes", {
        items: [{ kind: "image", name: fileName, mimeType: pasteMimeType, base64: bytes.toString("base64") }],
      });
      assert.equal(pasted.ok, true, pasted.error?.message);
      saved = pasted.result.saved[0];
      imagePath = saved.path;
    }
    const preview = await invoke("workspace:image-data-url", { filePath: imagePath });
    assert.equal(preview.ok, true, preview.error?.message);
    const final = await invoke("agent:chat", {
      text: "请说明图片内容",
      conversationId: "image-test-conversation",
      userMessageId: "user-image-test",
      assistantMessageId: "assistant-image-test",
      attachments: [{ path: imagePath }],
    });
    assert.equal(final?.ok, true, final?.error?.message || stderr.join(""));
    assert.equal(final.result.message, "已读取图片。");
    const conversationText = await fs.readFile(path.join(userDataRoot, "agent-conversations.json"), "utf8");
    return { final, imagePath, conversationText, progress, saved, preview: preview.result, fileBytes: await fs.readFile(imagePath) };
  } finally {
    child.kill();
    await closed;
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
    assert.equal(mock.requests[0].stream, true);
    const content = lastUserMessage(mock.requests[0]).content;
    assert.ok(Array.isArray(content));
    assert.match(content.find((item) => item.type === "text").text, /pasted\/sample\.png/);
    assert.match(content.find((item) => item.type === "image_url").image_url.url, /^data:image\/png;base64,/);
    assert.match(result.final.result.conversation.title, /请说明图片内容/);
    assert.equal(result.final.result.steps[0].title, "附带图片将由主模型直接读取");
    assert.ok(result.final.result.steps.some((step) => step.title === "正在分析请求"));
    assert.equal(result.final.result.steps.at(-1).title, "模型已生成最终回答");
    assert.ok(result.progress.some((event) => event.type === "agent-text" && event.text === "已读取图片。"));
    assert.doesNotMatch(result.conversationText, /data:image\/png;base64/);
    assert.match(result.conversationText, /sample\.png/);
  } finally {
    await mock.close();
  }
});

for (const { name, pasteMimeType, fileName, caption } of [
  { name: "BMP clipboard images are saved as PNG and sent to chat", pasteMimeType: "image/bmp", fileName: "pasted-image.bmp", caption: false },
  { name: "mislabeled BMP clipboard streams are encoded as PNG", pasteMimeType: "image/png", fileName: "pasted-image.png", caption: false },
  { name: "existing BMP workspace files are converted for image captioning", fileName: "old-image.bmp", caption: true },
]) {
  test(name, async () => {
    const mock = await startMockModel();
    try {
      const chat = provider("chat", "Chat", mock.baseUrl, "chat-model");
      const vision = provider("vision", "Vision", mock.baseUrl, "vision-model");
      const result = await runImageChat({
        activeProviderId: chat.id,
        providers: [chat],
        modelRoles: {
          chat: { enabled: true, activeProviderId: chat.id, providers: [chat] },
          image_caption: { enabled: caption, activeProviderId: vision.id, providers: [vision] },
        },
      }, { fileName, bytes: twoPixelBmp(), pasteMimeType });

      const imageRequest = mock.requests.find((request) => request.model === (caption ? "vision-model" : "chat-model"));
      const dataUrl = lastUserMessage(imageRequest).content.find((item) => item.type === "image_url").image_url.url;
      await assertRedGreenPng(dataUrl);
      await assertRedGreenPng(result.preview.dataUrl);
      assert.equal(result.preview.mimeType, "image/png");
      assert.doesNotMatch(result.conversationText, /data:image\//);
      if (pasteMimeType) {
        assert.match(result.saved.name, /\.png$/);
        assert.equal(result.saved.mimeType, "image/png");
        assert.equal(result.saved.sizeBytes, result.fileBytes.length);
        assert.deepEqual(result.fileBytes, Buffer.from(dataUrl.split(",")[1], "base64"));
      } else {
        assert.deepEqual(result.fileBytes, twoPixelBmp(), "Existing workspace files are not overwritten");
      }
      if (caption) {
        assert.equal(mock.requests.length, 2);
        assert.equal(typeof lastUserMessage(mock.requests.find((request) => request.model === "chat-model")).content, "string");
      }
    } finally {
      await mock.close();
    }
  });
}

test("AVIF image bytes are converted to decodable PNG", async () => {
  const canvas = createCanvas(2, 1);
  canvas.getContext("2d").fillRect(0, 0, 2, 1);
  const normalized = await normalizeModelImage(await canvas.encode("avif"));
  assert.equal(normalized.mimeType, "image/png");
  const image = await loadImage(normalized.buffer);
  assert.equal(image.width, 2);
  assert.equal(image.height, 1);
});

test("model-supported formats keep their original encoded bytes", async () => {
  const canvas = createCanvas(1, 1);
  const fixtures = [
    [onePixelPng, "image/png"],
    [await canvas.encode("jpeg"), "image/jpeg"],
    [await canvas.encode("webp"), "image/webp"],
    [Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), "image/gif"],
  ];
  for (const [buffer, mimeType] of fixtures) {
    const normalized = await normalizeModelImage(buffer);
    assert.equal(normalized.mimeType, mimeType);
    assert.deepEqual(normalized.buffer, buffer);
  }
});

test("unreadable images fail locally before any model request", async () => {
  const mock = await startMockModel();
  try {
    const chat = provider("chat", "Chat", mock.baseUrl, "chat-model");
    await assert.rejects(
      runImageChat({ activeProviderId: chat.id, providers: [chat] }, { fileName: "broken.bmp", bytes: Buffer.from("BM invalid bitmap") }),
      /无法读取图片/,
    );
    assert.equal(mock.requests.length, 0);
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
    assert.equal(chatRequest.stream, true);
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
