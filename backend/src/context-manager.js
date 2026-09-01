const DEFAULT_KEEP_RECENT_RATIO = 0.15;
const DEFAULT_TRIGGER_RATIO = 0.75;
const DEFAULT_TARGET_RATIO = 0.5;

function contentText(content) {
  if (typeof content === "string") return content;
  if (content == null) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

export function estimateTextTokens(value) {
  const text = contentText(value);
  if (!text) return 0;
  let cjk = 0;
  for (const char of text) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(char)) cjk += 1;
  }
  const other = Math.max(0, [...text].length - cjk);
  return Math.max(1, Math.ceil(cjk + other * 0.3));
}

export function estimateMessagesTokens(messages, tools = []) {
  let total = 0;
  for (const message of Array.isArray(messages) ? messages : []) {
    total += 4;
    total += estimateTextTokens(message?.role);
    total += estimateTextTokens(message?.name);
    total += estimateTextTokens(message?.content);
    total += estimateTextTokens(message?.tool_calls);
    total += estimateTextTokens(message?.tool_call_id);
  }
  if (Array.isArray(tools) && tools.length) total += estimateTextTokens(tools) + 8;
  return total;
}

export function splitIntoRounds(messages) {
  const leading = [];
  const rounds = [];
  let current = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.role === "system" && !rounds.length && !current.length) {
      leading.push(message);
      continue;
    }
    if (message?.role === "user" && current.length) {
      rounds.push(current);
      current = [];
    }
    current.push(message);
  }
  if (current.length) rounds.push(current);
  return { leading, rounds };
}

export function flattenRounds(rounds) {
  return (Array.isArray(rounds) ? rounds : []).flatMap((round) => round);
}

export function splitRecentRounds(rounds, totalTokens, keepRecentRatio = DEFAULT_KEEP_RECENT_RATIO) {
  if (!Array.isArray(rounds) || rounds.length <= 1) return { older: [], recent: rounds || [] };
  const ratio = Math.min(0.3, Math.max(0, Number(keepRecentRatio) || 0));
  const budget = Math.max(1, Math.floor(Math.max(0, totalTokens) * ratio));
  let used = 0;
  let recentStart = rounds.length - 1;
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const roundTokens = estimateMessagesTokens(rounds[index]);
    if (used > 0 && used + roundTokens > budget) break;
    used += roundTokens;
    recentStart = index;
  }
  if (recentStart === 0) recentStart = 1;
  return { older: rounds.slice(0, recentStart), recent: rounds.slice(recentStart) };
}

export function contextBudget(contextLength, options = {}) {
  const limit = Math.max(0, Number.parseInt(contextLength, 10) || 0);
  if (!limit) return { limit: 0, outputReserve: 0, triggerTokens: 0, targetTokens: 0 };
  const outputReserve = Math.min(8192, Math.max(1024, Math.ceil(limit * 0.2)));
  const triggerRatio = Math.min(0.9, Math.max(0.5, Number(options.triggerRatio) || DEFAULT_TRIGGER_RATIO));
  const targetRatio = Math.min(triggerRatio, Math.max(0.3, Number(options.targetRatio) || DEFAULT_TARGET_RATIO));
  return {
    limit,
    outputReserve,
    triggerTokens: Math.max(1, Math.min(Math.floor(limit * triggerRatio), limit - outputReserve)),
    targetTokens: Math.max(1, Math.min(Math.floor(limit * targetRatio), limit - outputReserve)),
  };
}

export function normalizeContextState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: 2,
    summary: String(source.summary || "").trim(),
    compactionCount: Math.max(0, Number.parseInt(source.compactionCount, 10) || 0),
    lastCompactedAt: String(source.lastCompactedAt || ""),
    lastCompactionReason: String(source.lastCompactionReason || ""),
    lastBeforeTokens: Math.max(0, Number.parseInt(source.lastBeforeTokens, 10) || 0),
    lastAfterTokens: Math.max(0, Number.parseInt(source.lastAfterTokens, 10) || 0),
    lastPromptTokens: Math.max(0, Number.parseInt(source.lastPromptTokens, 10) || 0),
    estimatedTokens: Math.max(0, Number.parseInt(source.estimatedTokens, 10) || 0),
    contextLength: Math.max(0, Number.parseInt(source.contextLength, 10) || 0),
  };
}

export function summaryMessage(summary) {
  const text = String(summary || "").trim();
  return text ? { role: "system", content: `此前对话的压缩摘要：\n${text}` } : null;
}

export const contextDefaults = Object.freeze({
  keepRecentRatio: DEFAULT_KEEP_RECENT_RATIO,
  triggerRatio: DEFAULT_TRIGGER_RATIO,
  targetRatio: DEFAULT_TARGET_RATIO,
});
