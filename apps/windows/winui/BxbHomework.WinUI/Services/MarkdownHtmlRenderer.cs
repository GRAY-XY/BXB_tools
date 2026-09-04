using System.Text;
using System.Text.Json;

namespace BxbHomework.WinUI.Services;

internal static class MarkdownHtmlRenderer
{
    public static string RenderConversation(
        IEnumerable<(string Id, string Role, string Text, bool IsRunning, JsonElement? Steps, bool ProcessExpanded)> messages,
        string theme = "light",
        bool followLatest = true,
        double scrollTop = 0,
        int viewVersion = 0)
    {
        var normalizedTheme = string.Equals(theme, "dark", StringComparison.OrdinalIgnoreCase) ? "dark" : "light";
        var rows = messages.Select(message => new
        {
            id = message.Id,
            role = message.Role == "user" ? "user" : "assistant",
            text = message.Text,
            running = message.IsRunning,
            steps = message.Steps.HasValue && message.Steps.Value.ValueKind == JsonValueKind.Array
                ? message.Steps.Value.EnumerateArray().Select(step => step.Clone()).ToArray()
                : Array.Empty<JsonElement>(),
            processExpanded = message.ProcessExpanded,
        }).ToList();
        var payload = JsonSerializer.Serialize(rows);
        var viewState = JsonSerializer.Serialize(new { followLatest, scrollTop, viewVersion });

        var assets = ResolveAssets();
        var markdownIt = ReadAsset(assets, "markdown-it.min.js");
        var texmath = ReadAsset(assets, "texmath.js");
        var katex = ReadAsset(assets, "katex.min.js");
        var domPurify = ReadAsset(assets, "purify.min.js");
        var katexCss = RewriteKatexCss(ReadAsset(assets, "katex.min.css"), assets);

        return $$"""
<!doctype html>
<html data-theme="{{normalizedTheme}}">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; style-src 'unsafe-inline'; font-src file: data:; script-src 'unsafe-inline';">
  <style>
{{katexCss}}
  </style>
  <style>
    :root {
      color-scheme: light;
      --bg: #ffffff;
      --fg: #1b1b1b;
      --muted: #5f5f5f;
      --border: rgba(0,0,0,.12);
      --code-bg: rgba(0,0,0,.055);
      --user-bg: rgba(0, 120, 212, .10);
      --link: #0067c0;
      --button-hover: rgba(0,0,0,.065);
      --process-line: rgba(0,0,0,.14);
      --process-active: #0067c0;
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --bg: #202020;
      --fg: #f3f3f3;
      --muted: #b8b8b8;
      --border: rgba(255,255,255,.14);
      --code-bg: rgba(255,255,255,.08);
      --user-bg: rgba(0, 120, 212, .22);
      --link: #65baff;
      --button-hover: rgba(255,255,255,.09);
      --process-line: rgba(255,255,255,.18);
      --process-active: #65baff;
    }
    html, body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      background: var(--bg);
      color: var(--fg);
      font: 15px/1.65 "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
      overflow-wrap: anywhere;
    }
    body { overflow-y: auto; }
    #app {
      width: min(820px, calc(100% - 48px));
      min-height: calc(100vh - 36px);
      margin: 0 auto;
      padding: 22px 0 14px;
      box-sizing: border-box;
    }
    .message {
      margin: 0 0 26px;
    }
    .message.user {
      display: flex;
      justify-content: flex-end;
    }
    .user-bubble {
      max-width: 74%;
      padding: 9px 13px;
      border-radius: 8px;
      background: var(--user-bg);
    }
    .message.assistant {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr);
      column-gap: 11px;
      align-items: start;
    }
    .assistant-avatar {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      display: grid;
      place-items: center;
      background: #0078d4;
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      line-height: 1;
      user-select: none;
    }
    .assistant-body { min-width: 0; }
    .process {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 13px;
    }
    .process > summary {
      min-height: 30px;
      display: flex;
      align-items: center;
      gap: 7px;
      width: fit-content;
      max-width: 100%;
      cursor: pointer;
      user-select: none;
      list-style: none;
      border-radius: 6px;
      padding: 1px 5px 1px 2px;
    }
    .process > summary::-webkit-details-marker { display: none; }
    .process > summary:hover { color: var(--fg); background: var(--button-hover); }
    .process-indicator {
      width: 14px;
      height: 14px;
      flex: 0 0 14px;
      box-sizing: border-box;
      border: 2px solid var(--process-line);
      border-top-color: var(--process-active);
      border-radius: 50%;
    }
    .process.running .process-indicator { animation: spin .9s linear infinite; }
    .process.complete .process-indicator {
      border: 0;
      border-radius: 0;
      color: var(--muted);
    }
    .process.complete .process-indicator::before { content: "✓"; font-weight: 600; }
    .process-label { color: var(--fg); font-weight: 600; white-space: nowrap; }
    .process-current { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .process-chevron { margin-left: 1px; transform: rotate(0deg); transition: transform .14s ease; }
    .process[open] > summary .process-chevron { transform: rotate(90deg); }
    .process-timeline {
      margin: 7px 0 3px 7px;
      padding: 2px 0 2px 17px;
      border-left: 1px solid var(--process-line);
    }
    .process-step { position: relative; padding: 1px 0 13px; color: var(--fg); }
    .process-step:last-child { padding-bottom: 3px; }
    .process-step::before {
      content: "";
      position: absolute;
      width: 7px;
      height: 7px;
      left: -21px;
      top: 7px;
      border-radius: 50%;
      background: var(--process-line);
      box-shadow: 0 0 0 3px var(--bg);
    }
    .process-step.active::before { background: var(--process-active); }
    .step-heading { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .step-title { font-weight: 600; overflow-wrap: anywhere; }
    .step-meta { color: var(--muted); font-size: 11px; white-space: nowrap; }
    .step-disclosure > summary {
      display: flex;
      align-items: baseline;
      gap: 8px;
      width: fit-content;
      max-width: 100%;
      cursor: pointer;
      list-style: none;
      border-radius: 5px;
      padding: 1px 4px 1px 0;
    }
    .step-disclosure > summary::-webkit-details-marker { display: none; }
    .step-disclosure > summary:hover { background: var(--button-hover); }
    .step-disclosure-chevron {
      color: var(--muted);
      font-size: 12px;
      transform: rotate(0deg);
      transition: transform .14s ease;
    }
    .step-disclosure[open] > summary .step-disclosure-chevron { transform: rotate(90deg); }
    .step-detail-content { padding-left: 15px; }
    .step-detail { margin-top: 4px; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
    .step-fields { display: grid; grid-template-columns: minmax(72px, auto) minmax(0, 1fr); gap: 3px 12px; margin-top: 5px; }
    .step-field-name { color: var(--muted); }
    .step-field-value { color: var(--fg); white-space: pre-wrap; overflow-wrap: anywhere; }
    @keyframes pulse {
      0%, 100% { opacity: .35; transform: scale(.85); }
      50% { opacity: 1; transform: scale(1); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .message-actions {
      display: flex;
      gap: 4px;
      min-height: 30px;
      margin-top: 6px;
      opacity: 0;
      transition: opacity .12s ease;
    }
    .message.assistant:hover .message-actions,
    .message-actions:focus-within,
    .message.running .message-actions { opacity: 1; }
    .message-action {
      border: 0;
      border-radius: 6px;
      padding: 5px 8px;
      background: transparent;
      color: var(--muted);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .message-action:hover { background: var(--button-hover); color: var(--fg); }
    .empty-state {
      min-height: calc(100vh - 120px);
      display: grid;
      place-content: center;
      text-align: center;
    }
    .empty-mark {
      width: 42px;
      height: 42px;
      margin: 0 auto 14px;
      border-radius: 8px;
      display: grid;
      place-items: center;
      background: #0078d4;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
    }
    .empty-state h2 { margin: 0 0 6px; font-size: 20px; }
    .empty-state p { margin: 0 0 18px; color: var(--muted); }
    .suggestions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
    .suggestion {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 11px;
      background: transparent;
      color: var(--fg);
      font: inherit;
      cursor: pointer;
    }
    .suggestion:hover { background: var(--button-hover); }
    #jump-latest {
      position: fixed;
      right: 20px;
      bottom: 14px;
      width: 36px;
      height: 36px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--bg);
      color: var(--fg);
      box-shadow: 0 3px 12px rgba(0,0,0,.14);
      cursor: pointer;
      display: none;
      z-index: 5;
    }
    .content > :first-child { margin-top: 0; }
    .content > :last-child { margin-bottom: 0; }
    h1, h2, h3, h4 { line-height: 1.25; margin: .75em 0 .35em; }
    h1 { font-size: 1.5em; }
    h2 { font-size: 1.3em; }
    h3 { font-size: 1.15em; }
    p, ul, ol, blockquote, pre, table { margin: .45em 0; }
    ul, ol { padding-left: 1.45em; }
    blockquote {
      border-left: 3px solid var(--border);
      margin-left: 0;
      padding-left: .8em;
      color: var(--muted);
    }
    code, pre {
      font-family: Consolas, "Cascadia Mono", "Courier New", monospace;
      font-size: 13px;
    }
    code {
      background: var(--code-bg);
      border-radius: 4px;
      padding: 1px 4px;
    }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      overflow-x: auto;
      white-space: pre;
    }
    pre code {
      background: transparent;
      padding: 0;
      border-radius: 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      display: block;
      overflow-x: auto;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th { background: var(--code-bg); }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; height: auto; }
    .katex-display { overflow-x: auto; overflow-y: hidden; padding: 3px 0; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
{{markdownIt}}
  </script>
  <script>
{{katex}}
  </script>
  <script>
{{texmath}}
  </script>
  <script>
{{domPurify}}
  </script>
  <script>
    const messages = {{payload}};
    const md = window.markdownit({
      html: false,
      linkify: true,
      typographer: true,
      breaks: true
    });
    if (window.texmath && window.katex) {
      md.use(window.texmath, {
        engine: window.katex,
        delimiters: ['dollars', 'beg_end'],
        katexOptions: { throwOnError: false, strict: false }
      });
    }

    const stepKindLabels = {
      llm: '模型',
      tool: '工具',
      context: '上下文',
      vision: '图片',
      done: '完成',
      error: '错误',
      canceled: '已停止'
    };
    const stepFieldLabels = {
      task_id: 'Task ID', taskId: 'Task ID', draft_id: '草稿 ID', draftId: '草稿 ID',
      filePath: '路径', path: '路径', fileName: '名称', name: '名称', title: '标题',
      message: '信息', status: '状态', ok: '成功', error: '错误', text: '内容', content: '内容',
      count: '数量', total: '总数', page: '页码', size: '大小'
    };

    function truncateText(value, limit = 520) {
      const text = String(value == null ? '' : value);
      return text.length > limit ? `${text.slice(0, limit)}…` : text;
    }

    function summarizeStepValue(value) {
      if (value == null) return '';
      if (typeof value === 'boolean') return value ? '是' : '否';
      if (typeof value === 'string' || typeof value === 'number') return truncateText(value);
      if (Array.isArray(value)) {
        const primitives = value.filter(item => item == null || ['string', 'number', 'boolean'].includes(typeof item)).slice(0, 5);
        return primitives.length ? `${primitives.map(item => summarizeStepValue(item)).join('、')}${value.length > primitives.length ? ` 等 ${value.length} 项` : ''}` : `${value.length} 项`;
      }
      if (typeof value === 'object') {
        for (const key of ['message', 'title', 'name', 'status', 'ok', 'error', 'summary', 'text']) {
          if (Object.prototype.hasOwnProperty.call(value, key)) return summarizeStepValue(value[key]);
        }
        return `${Object.keys(value).length} 个字段`;
      }
      return truncateText(value);
    }

    function renderStepDetail(detail) {
      if (!detail) return '';
      let parsed;
      try { parsed = JSON.parse(detail); } catch { parsed = null; }
      if (!parsed || typeof parsed !== 'object') {
        return `<div class="step-detail">${escapeHtml(truncateText(detail, 1200))}</div>`;
      }
      const entries = (Array.isArray(parsed) ? parsed.map((value, index) => [String(index + 1), value]) : Object.entries(parsed))
        .filter(([key]) => key !== 'raw' && key !== 'html')
        .slice(0, 12)
        .map(([key, value]) => [stepFieldLabels[key] || key, summarizeStepValue(value)])
        .filter(([, value]) => value);
      if (!entries.length) return '<div class="step-detail">结果为空。</div>';
      return `<div class="step-fields">${entries.map(([key, value]) => `<div class="step-field-name">${escapeHtml(key)}</div><div class="step-field-value">${escapeHtml(value)}</div>`).join('')}</div>`;
    }

    function formatStepTime(value) {
      const date = new Date(value || '');
      return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function processDuration(steps) {
      if (steps.length < 2) return '';
      const start = new Date(steps[0].at || '').getTime();
      const end = new Date(steps[steps.length - 1].at || '').getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
      const seconds = Math.max(1, Math.round((end - start) / 1000));
      return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    }

    function renderProcess(message) {
      const steps = Array.isArray(message.steps) ? message.steps : [];
      if (!message.running && !steps.length) return '';
      const latest = steps.length ? steps[steps.length - 1] : null;
      const currentTitle = latest && (latest.title || latest.kind) ? String(latest.title || latest.kind) : '准备请求模型';
      const duration = processDuration(steps);
      const statusText = message.running ? 'Thinking' : '执行过程';
      const secondaryText = message.running
        ? currentTitle
        : `${steps.length} 个步骤${duration ? ` · ${duration}` : ''}`;
      const timeline = steps.length
        ? steps.map((step, index) => {
            const title = escapeHtml(step.title || step.kind || `步骤 ${index + 1}`);
            const meta = [stepKindLabels[step.kind] || step.kind || '', formatStepTime(step.at)].filter(Boolean).join(' · ');
            const active = message.running && index === steps.length - 1 ? ' active' : '';
            const heading = `<span class="step-title">${title}</span>${meta ? `<span class="step-meta">${escapeHtml(meta)}</span>` : ''}`;
            const detail = renderStepDetail(step.detail || '');
            const body = detail
              ? `<details class="step-disclosure"><summary>${heading}<span class="step-disclosure-chevron">›</span></summary><div class="step-detail-content">${detail}</div></details>`
              : `<div class="step-heading">${heading}</div>`;
            return `<div class="process-step${active}">${body}</div>`;
          }).join('')
        : '<div class="step-detail">正在准备请求模型…</div>';
      return `<details class="process ${message.running ? 'running' : 'complete'}" data-process-id="${escapeHtml(message.id || '')}"${message.processExpanded ? ' open' : ''}><summary><span class="process-indicator"></span><span class="process-label">${statusText}</span><span class="process-current">· ${escapeHtml(secondaryText)}</span><span class="process-chevron">›</span></summary><div class="process-timeline">${timeline}</div></details>`;
    }

    function renderMessage(message) {
      const raw = md.render(message.text || "");
      const clean = DOMPurify.sanitize(raw, {
        ADD_TAGS: ['math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'mfrac', 'msqrt', 'mtext', 'eq', 'eqn', 'section'],
        ADD_ATTR: ['display', 'encoding', 'class', 'style', 'aria-hidden']
      });
      const role = message.role === "user" ? "user" : "assistant";
      const id = escapeHtml(message.id || "");
      if (role === "user") {
        return `<section class="message user" data-id="${id}"><div class="user-bubble content">${clean}</div></section>`;
      }
      const running = message.running ? " running" : "";
      const process = renderProcess(message);
      const content = clean ? `<div class="content">${clean}</div>` : "";
      const copyAction = clean ? '<div class="message-actions"><button class="message-action" type="button" data-action="copy">复制</button></div>' : '';
      return `<section class="message assistant${running}" data-id="${id}"><div class="assistant-avatar">BXB</div><div class="assistant-body">${process}${content}${copyAction}</div></section>`;
    }

    function escapeHtml(text) {
      return String(text).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch]));
    }

    const viewState = {{viewState}};
    const app = document.getElementById("app");
    app.innerHTML = messages.length
      ? messages.map(renderMessage).join("")
      : `<section class="empty-state"><div><div class="empty-mark">BXB</div><h2>今天需要处理什么？</h2><p>可以查看作业、整理资料或创建提交草稿。</p><div class="suggestions"><button class="suggestion" data-suggestion="列出待处理作业">查看待处理作业</button><button class="suggestion" data-suggestion="帮我整理一个作业草稿">整理作业草稿</button></div></div></section>`;
    document.body.insertAdjacentHTML("beforeend", `<button id="jump-latest" type="button" aria-label="回到最新消息">↓</button>`);

    function postMessage(payload) {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage({ ...payload, viewVersion: viewState.viewVersion });
      }
    }

    document.querySelectorAll('details.process[data-process-id]').forEach((details) => {
      details.addEventListener('toggle', () => {
        postMessage({ type: 'process-state', id: details.getAttribute('data-process-id') || '', expanded: details.open });
      });
    });

    document.addEventListener("click", (event) => {
      const link = event.target.closest && event.target.closest("a[href]");
      if (link) {
        event.preventDefault();
        postMessage({ type: "open-link", href: link.href });
        return;
      }

      const suggestion = event.target.closest && event.target.closest("[data-suggestion]");
      if (suggestion) {
        postMessage({ type: "send-suggestion", text: suggestion.getAttribute("data-suggestion") || "" });
        return;
      }

      const action = event.target.closest && event.target.closest("[data-action]");
      if (action) {
        const message = action.closest(".message.assistant[data-id]");
        const id = message ? message.getAttribute("data-id") || "" : "";
        if (!id) return;
        postMessage({ type: "copy-message", id });
      }
    });

    const jumpButton = document.getElementById("jump-latest");
    function isNearBottom() {
      return document.documentElement.scrollHeight - window.innerHeight - window.scrollY < 90;
    }
    function updateJumpButton() {
      jumpButton.style.display = isNearBottom() ? "none" : "block";
    }
    let scrollTimer = 0;
    window.addEventListener("scroll", () => {
      updateJumpButton();
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        postMessage({ type: "scroll-state", nearBottom: isNearBottom(), scrollTop: window.scrollY });
      }, 80);
    }, { passive: true });
    jumpButton.addEventListener("click", () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
    requestAnimationFrame(() => {
      window.scrollTo(0, viewState.followLatest ? document.documentElement.scrollHeight : Number(viewState.scrollTop || 0));
      updateJumpButton();
      postMessage({ type: "scroll-state", nearBottom: isNearBottom(), scrollTop: window.scrollY });
    });
  </script>
</body>
</html>
""";
    }

    private static string ReadAsset(string assetsRoot, string name)
    {
        var path = Path.Combine(assetsRoot, name);
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"Cannot find markdown renderer asset: {name}", path);
        }
        return File.ReadAllText(path, Encoding.UTF8);
    }

    private static string RewriteKatexCss(string css, string assetsRoot)
    {
        var fontRoot = new Uri(Path.Combine(assetsRoot, "fonts") + Path.DirectorySeparatorChar).AbsoluteUri;
        return css.Replace("url(fonts/", $"url({fontRoot}", StringComparison.Ordinal);
    }

    private static string ResolveAssets()
    {
        var outputAssets = Path.Combine(AppContext.BaseDirectory, "MarkdownAssets");
        if (Directory.Exists(outputAssets))
        {
            return outputAssets;
        }

        throw new DirectoryNotFoundException(
            $"Cannot find markdown renderer assets at {outputAssets}. Run the WinUI build so node_modules assets are copied to the output directory.");
    }
}
