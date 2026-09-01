using System.Text;
using System.Text.Json;

namespace BxbHomework.WinUI.Services;

internal static class MarkdownHtmlRenderer
{
    public static string RenderConversation(
        IEnumerable<(string Id, string Role, string Text, bool IsRunning, int StepCount)> messages,
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
            stepCount = message.StepCount,
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
    .assistant-status {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 28px;
      color: var(--muted);
      font-size: 13px;
    }
    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--link);
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: .35; transform: scale(.85); }
      50% { opacity: 1; transform: scale(1); }
    }
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
      const status = message.running
        ? `<div class="assistant-status"><span class="status-dot"></span><span>正在处理请求</span></div>`
        : "";
      const processLabel = Number(message.stepCount || 0) > 0
        ? `查看过程 · ${Number(message.stepCount)} 步`
        : "查看过程";
      const content = clean ? `<div class="content">${clean}</div>` : "";
      return `<section class="message assistant${running}" data-id="${id}"><div class="assistant-avatar">BXB</div><div class="assistant-body">${status}${content}<div class="message-actions"><button class="message-action" type="button" data-action="copy">复制</button><button class="message-action" type="button" data-action="process">${processLabel}</button></div></div></section>`;
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
        postMessage({ type: action.getAttribute("data-action") === "copy" ? "copy-message" : "show-process", id });
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
