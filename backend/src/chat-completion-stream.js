function contentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => String(part?.text || part?.content || "")).join("");
}

function mergeToolCall(targets, delta) {
  const index = Number.isInteger(delta?.index) ? delta.index : targets.length;
  const current = targets[index] || { id: "", type: "function", function: { name: "", arguments: "" } };
  if (delta?.id) current.id = String(delta.id);
  if (delta?.type) current.type = String(delta.type);
  if (delta?.function?.name) current.function.name += String(delta.function.name);
  if (delta?.function?.arguments) current.function.arguments += String(delta.function.arguments);
  targets[index] = current;
}

function completionPayload(content, toolCalls, usage, finishReason) {
  return {
    choices: [{
      message: {
        role: "assistant",
        content,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReason || null,
    }],
    ...(usage ? { usage } : {}),
  };
}

function parseSseEvent(eventText, state, onText) {
  const data = String(eventText || "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return;
  if (data === "[DONE]") {
    state.done = true;
    return;
  }

  const payload = JSON.parse(data);
  if (payload?.error) {
    throw new Error(String(payload.error?.message || payload.error || "模型流返回错误。"));
  }
  if (payload?.usage) state.usage = payload.usage;
  const choice = payload?.choices?.[0];
  if (!choice) return;
  if (choice.finish_reason) state.finishReason = choice.finish_reason;
  const delta = choice.delta || choice.message || {};
  const text = contentText(delta.content);
  if (text) {
    state.content += text;
    onText?.(state.content, text);
  }
  for (const toolCall of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
    mergeToolCall(state.toolCalls, toolCall);
  }
}

async function parseEventStream(response, onText) {
  const state = { content: "", toolCalls: [], usage: null, finishReason: "", done: false };
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for await (const chunk of response.body || []) {
      buffer += decoder.decode(chunk, { stream: true });
      let separator = buffer.search(/\r?\n\r?\n/);
      while (separator >= 0) {
        const eventText = buffer.slice(0, separator);
        const separatorLength = buffer.slice(separator).startsWith("\r\n\r\n") ? 4 : 2;
        buffer = buffer.slice(separator + separatorLength);
        parseSseEvent(eventText, state, onText);
        separator = buffer.search(/\r?\n\r?\n/);
      }
    }
  } catch (error) {
    // Some providers close the socket immediately after their final SSE event.
    if (!state.done && !state.finishReason) {
      error.partialContent = state.content;
      throw error;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) parseSseEvent(buffer, state, onText);
  if (!state.done && !state.finishReason) {
    const error = new Error("模型流在完成前中断。");
    error.code = "ERR_INCOMPLETE_MODEL_STREAM";
    error.partialContent = state.content;
    throw error;
  }
  return completionPayload(state.content, state.toolCalls.filter(Boolean), state.usage, state.finishReason);
}

function errorChainText(error) {
  const parts = [];
  const visited = new Set();
  let current = error;
  while (current && !visited.has(current)) {
    visited.add(current);
    parts.push(String(current?.code || ""), String(current?.message || current || ""));
    current = current?.cause;
  }
  return parts.join(" ").toLowerCase();
}

export function isRetryableStreamError(error) {
  const message = errorChainText(error);
  return [
    "terminated",
    "fetch failed",
    "socket",
    "econnreset",
    "etimedout",
    "epipe",
    "und_err_socket",
    "premature",
    "err_incomplete_model_stream",
    "模型流在完成前中断",
  ].some((token) => message.includes(token));
}

function abortError(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

async function waitForRecovery(delayMs, signal) {
  if (signal?.aborted) throw abortError(signal);
  if (!(delayMs > 0)) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function requestChatCompletionWithRecovery({
  fetchImpl = globalThis.fetch,
  url,
  headers,
  payload,
  signal,
  onText,
  onRecovery,
  streamAttempts = 2,
  recoveryDelayMs = 600,
} = {}) {
  const attempts = Math.max(1, Number.parseInt(streamAttempts, 10) || 1);
  let lastStreamError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        signal,
        headers,
        body: JSON.stringify({ ...payload, stream: true }),
      });
      return await readChatCompletionResponse(response, { onText });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError" || !isRetryableStreamError(error)) throw error;
      lastStreamError = error;
      if (attempt < attempts) {
        onRecovery?.({ phase: "retry", attempt: attempt + 1, error });
        await waitForRecovery(recoveryDelayMs, signal);
      }
    }
  }

  onRecovery?.({ phase: "fallback", error: lastStreamError });
  const response = await fetchImpl(url, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({ ...payload, stream: false }),
  });
  return readChatCompletionResponse(response, { onText });
}

export async function readChatCompletionResponse(response, { onText } = {}) {
  if (!response.ok) {
    return { ok: false, status: response.status, raw: await response.text(), payload: null };
  }

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/event-stream")) {
    return { ok: true, status: response.status, raw: "", payload: await parseEventStream(response, onText) };
  }

  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : {};
  const text = contentText(payload?.choices?.[0]?.message?.content);
  if (text) onText?.(text, text);
  return { ok: true, status: response.status, raw, payload };
}
