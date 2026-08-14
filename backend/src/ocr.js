import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "ocr_vision.swift");

/**
 * Run macOS Vision OCR on an image file. Returns recognized text.
 * Throws if the Swift runtime is unavailable or OCR fails.
 */
export async function runOcr(imagePath) {
  const { stdout } = await execFileAsync("swift", [scriptPath, imagePath], {
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(stdout || "").trim();
}

function deriveChatUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/models")) return `${normalized.slice(0, -"/models".length)}/chat/completions`;
  if (/\/v\d+$/.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

export async function transcribeImageWithModel(imagePath, modelConfig) {
  const buffer = await readFile(imagePath);
  if (buffer.byteLength > 6 * 1024 * 1024) {
    throw new Error("图片超过 6MB，无法用模型识别。");
  }
  const extension = path.extname(imagePath).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  const base64 = buffer.toString("base64");
  const response = await fetch(deriveChatUrl(modelConfig.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${modelConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: modelConfig.modelName,
      messages: [
        {
          role: "system",
          content: "你是作业助手。请识别图片中的文字并原样输出；如果图片是题目，请同时给出题目文本。",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "请识别这张图片：" },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });
  if (!response.ok) {
    throw new Error(`模型返回 HTTP ${response.status}`);
  }
  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

/**
 * Try local macOS Vision OCR first; fall back to the configured model when
 * BANXUEBANG_MODEL_BASE_URL / BANXUEBANG_MODEL_API_KEY / BANXUEBANG_MODEL_NAME are set.
 * Throws when neither works.
 */
export async function extractImageText(imagePath) {
  try {
    const local = await runOcr(imagePath);
    if (local) {
      return local;
    }
  } catch {
    // 本地 OCR 不可用时走模型兜底
  }
  const baseUrl = process.env.BANXUEBANG_MODEL_BASE_URL;
  const apiKey = process.env.BANXUEBANG_MODEL_API_KEY;
  const modelName = process.env.BANXUEBANG_MODEL_NAME;
  if (baseUrl && apiKey && modelName) {
    return transcribeImageWithModel(imagePath, { baseUrl, apiKey, modelName });
  }
  throw new Error("图片无法识别：本地 OCR 不可用且未配置模型。");
}
