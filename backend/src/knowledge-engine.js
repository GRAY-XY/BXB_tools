import path from "node:path";
import { readFile } from "node:fs/promises";
import { runOcr } from "./ocr.js";

const MAX_TASKS = 50;
const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

function deriveChatUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) return normalized;
  if (normalized.endsWith("/models")) return `${normalized.slice(0, -"/models".length)}/chat/completions`;
  if (/\/v\d+$/.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

async function transcribeImageWithModel(imagePath, modelConfig) {
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
 * Collect readable homework content (task body + attachment texts) for a list of task ids.
 * Skips tasks that fail or have no readable text.
 */
export async function collectTaskKnowledge(
  client,
  taskIds,
  { maxChars = 8000, maxAttachments = 6, modelConfig = null } = {},
) {
  const entries = [];
  const skipped = [];
  for (const taskId of (taskIds || []).slice(0, MAX_TASKS)) {
    try {
      const detail = await client.collectTaskSubmissionContext(taskId, { maxChars, maxAttachments });
      const subject = detail.subjectName || "未分类";
      const title = detail.taskSummary?.activityName || `作业 ${detail.taskId}`;
      const texts = [];
      if (detail.contentText) {
        texts.push(`【题目】\n${detail.contentText}`);
      }
      if (detail.answerText) {
        texts.push(`【参考答案】\n${detail.answerText}`);
      }
      for (const attachment of detail.attachmentContexts || []) {
        if (attachment.readable && attachment.text) {
          texts.push(`【附件：${attachment.fileName || attachment.fileId}】\n${attachment.text}`);
          continue;
        }
        const extension = path.extname(attachment.fileName || "").toLowerCase();
        if (attachment.localPath && IMAGE_EXTENSIONS.has(extension)) {
          let ocrText = "";
          try {
            ocrText = await runOcr(attachment.localPath);
          } catch {
            ocrText = "";
          }
          if (!ocrText && modelConfig?.apiKey && modelConfig?.baseUrl && modelConfig?.modelName) {
            try {
              ocrText = await transcribeImageWithModel(attachment.localPath, modelConfig);
            } catch {
              ocrText = "";
            }
          }
          if (ocrText) {
            texts.push(`【附件：${attachment.fileName || attachment.fileId}（图片识别）】\n${ocrText}`);
          } else {
            skipped.push({
              fileName: attachment.fileName || attachment.fileId,
              reason: "图片无法识别（本地 OCR 与模型识别均不可用）",
            });
          }
        }
      }
      if (texts.length) {
        entries.push({
          taskId: String(detail.taskId ?? taskId),
          title,
          subject,
          text: texts.join("\n\n"),
        });
      }
    } catch {
      // 单条任务失败不阻塞整批处理
    }
  }
  return { entries, skipped };
}

/**
 * Group collected entries by subject, preserving task order.
 */
export function aggregateBySubject(entries) {
  const groups = new Map();
  for (const entry of entries || []) {
    const key = entry.subject || "未分类";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  }
  return [...groups.entries()].map(([subject, items]) => ({ subject, items }));
}

export function sanitizeTopicName(value) {
  return String(value || "note")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
