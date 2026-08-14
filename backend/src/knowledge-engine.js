import path from "node:path";
import { extractImageText } from "./ocr.js";

const MAX_TASKS = 50;
const IMAGE_EXTENSIONS = new Set([".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

/**
 * Collect readable homework content (task body + attachment texts) for a list of task ids.
 * Skips tasks that fail or have no readable text.
 */
export async function collectTaskKnowledge(
  client,
  taskIds,
  { maxChars = 8000, maxAttachments = 6 } = {},
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
            ocrText = await extractImageText(attachment.localPath);
          } catch {
            ocrText = "";
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
