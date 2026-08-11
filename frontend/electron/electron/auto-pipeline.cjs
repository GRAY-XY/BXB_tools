const fs = require("node:fs/promises");
const path = require("node:path");

function deriveChatUrl(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  if (normalized.endsWith("/models")) {
    return `${normalized.slice(0, -"/models".length)}/chat/completions`;
  }
  if (/\/v\d+$/.test(normalized)) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

const MODE_LABELS = {
  draft: "仅生成草稿",
  review: "审核后提交（默认）",
  auto: "自动生成并标记已审核（发出前仍需你确认）",
};

async function loadCourseModes(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function saveCourseMode(filePath, courseId, mode) {
  const modes = await loadCourseModes(filePath);
  modes[String(courseId)] = mode;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(modes, null, 2), "utf8");
  return modes;
}

function modeFor(modes, courseId) {
  return modes[String(courseId)] || "review";
}

async function generateDraftForTask(client, taskId, modelConfig) {
  const detail = await client.collectTaskSubmissionContext(taskId, { maxChars: 8000, maxAttachments: 6 });
  if (!detail.isSufficient) {
    return { ok: false, reason: (detail.missingInfo || []).join("；") || "上下文不足" };
  }
  const inputText = [
    detail.requirementsSummary,
    detail.contentText ? `【题目】\n${detail.contentText}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 12000);
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
          content:
            "你是作业助手。根据作业要求生成可直接提交的纯文本答案：不使用 Markdown 标题/列表/表格/代码块/加粗。内容具体、完整、符合学生身份；不确定的地方明确说明。",
        },
        { role: "user", content: inputText },
      ],
      temperature: 0.4,
    }),
  });
  if (!response.ok) {
    throw new Error(`模型返回 HTTP ${response.status}`);
  }
  const data = await response.json();
  const text = String(data?.choices?.[0]?.message?.content || "").trim();
  if (!text) {
    return { ok: false, reason: "模型没有返回答案" };
  }
  return { ok: true, text, detail };
}

module.exports = { MODE_LABELS, loadCourseModes, saveCourseMode, modeFor, generateDraftForTask };
