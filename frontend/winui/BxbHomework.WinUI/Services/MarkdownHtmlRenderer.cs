using System.Text;
using System.Text.Json;

namespace BxbHomework.WinUI.Services;

internal static class MarkdownHtmlRenderer
{
    private const string EmptyState = "暂无消息。";

    public static string RenderConversation(IEnumerable<(string Id, string Role, string Text, bool IsSelected, bool IsRunning)> messages, string theme = "light")
    {
        var normalizedTheme = string.Equals(theme, "dark", StringComparison.OrdinalIgnoreCase) ? "dark" : "light";
        var rows = messages.Select(message => new
        {
            id = message.Id,
            role = message.Role == "user" ? "user" : "assistant",
            label = message.Role == "user" ? "你" : "助手",
            text = message.Text,
            selected = message.IsSelected,
            running = message.IsRunning,
        }).ToList();

        var payload = rows.Count == 0
            ? JsonSerializer.Serialize(new[] { new { id = "", role = "assistant", label = "助手", text = EmptyState, selected = false, running = false } })
            : JsonSerializer.Serialize(rows);

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
      --assistant-bg: rgba(0,0,0,.025);
      --user-bg: rgba(0, 120, 212, .10);
      --link: #0067c0;
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --bg: #202020;
      --fg: #f3f3f3;
      --muted: #b8b8b8;
      --border: rgba(255,255,255,.14);
      --code-bg: rgba(255,255,255,.08);
      --assistant-bg: rgba(255,255,255,.035);
      --user-bg: rgba(16, 124, 16, .16);
      --link: #65baff;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--fg);
      font: 14px/1.55 "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif;
      overflow-wrap: anywhere;
    }
    body { padding: 0 2px 16px 0; }
    .message {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      margin: 0 0 10px 0;
      background: var(--assistant-bg);
    }
    .message.user { background: var(--user-bg); }
    .message.assistant { cursor: pointer; }
    .message.selected {
      border-color: var(--link);
      box-shadow: inset 3px 0 0 var(--link);
    }
    .message.running .role::after {
      content: " · 执行中";
      color: var(--link);
      font-weight: 600;
    }
    .role {
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
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
      const selected = message.selected ? " selected" : "";
      const running = message.running ? " running" : "";
      const id = escapeHtml(message.id || "");
      return `<section class="message ${role}${selected}${running}" data-id="${id}" data-role="${role}"><div class="role">${escapeHtml(message.label || "")}</div><div class="content">${clean}</div></section>`;
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

    document.getElementById("app").innerHTML = messages.map(renderMessage).join("");
    document.addEventListener("click", (event) => {
      const link = event.target.closest && event.target.closest("a[href]");
      if (link) {
        event.preventDefault();
        if (window.chrome && window.chrome.webview) {
          window.chrome.webview.postMessage({ type: "open-link", href: link.href });
        }
        return;
      }

      const message = event.target.closest && event.target.closest(".message.assistant[data-id]");
      if (!message) return;
      const id = message.getAttribute("data-id") || "";
      if (id && window.chrome && window.chrome.webview) {
        document.querySelectorAll(".message.selected").forEach((node) => node.classList.remove("selected"));
        message.classList.add("selected");
        window.chrome.webview.postMessage({ type: "select-message", id });
      }
    });
    requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
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
