const MAX_TASKS = 50;

/**
 * Collect readable homework content (task body + attachment texts) for a list of task ids.
 * Skips tasks that fail or have no readable text.
 */
export async function collectTaskKnowledge(client, taskIds, { maxChars = 8000, maxAttachments = 6 } = {}) {
  const entries = [];
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
  return entries;
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
