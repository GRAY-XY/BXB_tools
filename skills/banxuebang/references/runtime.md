# Runtime, Installation, and State

Copy the whole `banxuebang/` directory when distributing the skill. Keep `SKILL.md`, `agents/`, `scripts/`, `runtime/`, `references/`, `package.json`, `package-lock.json`, `.nvmrc`, `runtime-manifest.json`, and `LICENSE` together. The source snapshot is included; no path points back to a developer's checkout.

## Install Dependencies

Run the package's `scripts/setup.mjs` with a full Node.js installation, including npm:

```text
node /absolute/path/banxuebang/scripts/setup.mjs --browser
node /absolute/path/banxuebang/scripts/bxb.mjs doctor
```

This runs `npm ci` inside the skill using its lockfile. It installs dependencies for the receiving machine, including native canvas binaries. It does not copy the build machine's `node_modules` or browser binaries. Network access is required for the initial npm/browser downloads. Python is not required for setup.

`doctor` reports whether dependencies are installed in this package, the selected paths, and whether a session file exists. It does not validate account tokens, launch a browser, call a model, or prove live account readiness. Native dependency and browser support still depend on the receiving OS/architecture; this package was locally exercised on Windows x64.

Run `node scripts/setup.mjs` without `--browser` for file/API work. Browser tools need Chromium; Linux hosts may also need Playwright's OS libraries. `run_python_snippet` needs a `python` command on `PATH` and runs outside a security sandbox.

## Data Locations

| Platform | Default data root |
| --- | --- |
| Windows | `%LOCALAPPDATA%/bxb-agent` |
| macOS | `~/Library/Application Support/bxb-agent` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/bxb-agent` |

The root contains `session.json`, `drafts/`, `workspace/`, and generated `screenshots/`. Draft attachment copies live in `drafts/attachments/`. No account data is bundled with the skill.

Environment overrides apply equally to CLI and MCP:

| Variable | Purpose |
| --- | --- |
| `BXB_AGENT_DATA_DIR` | Replace the default data root. |
| `BANXUEBANG_SESSION_FILE` | Use a specific session JSON file. |
| `BANXUEBANG_DRAFT_DIR` | Use a specific draft directory, including attachment copies. |
| `BANXUEBANG_WORKSPACE_DIR` | Use a specific workspace directory. |
| `PLAYWRIGHT_BROWSERS_PATH` | Override the Playwright browser cache when needed. |

Relative override paths resolve against the caller's current directory. Prefer absolute paths for persistent configurations. JSON argument file paths also resolve against the caller's directory. Workspace file arguments resolve inside the selected workspace.

### Reuse Windows Desktop Data

Only do this when the user intends to share data with the desktop application. Close other writers while changing shared context or drafts. The existing Windows desktop directory is:

```powershell
$env:BXB_AGENT_DATA_DIR = Join-Path $env:APPDATA 'bxb-homework-electron\.banxuebang'
node 'C:/path/to/banxuebang/scripts/bxb.mjs' call session_status
```

This points at existing data; it does not copy, import, print, or modify a session by itself. A later tool call may refresh the session or change shared account context. Do not include this personal data directory in a ZIP or commit it.

## JSON Arguments

For long or nested input, save UTF-8 JSON and use `--args-file`. UTF-8 BOMs are accepted.

```json
{"list_type":"pending","page":1,"size":50}
```

```text
node /absolute/path/banxuebang/scripts/bxb.mjs call list_tasks --args-file /absolute/path/task-query.json
```

Use `--stdin` for credentials if the host can provide stdin privately. Do not put passwords in process arguments, checked-in JSON, or the transcript. Manual browser login avoids handling the password in tool arguments.

## MCP Stdio

Example generic MCP server entry; substitute actual absolute paths:

```json
{
  "mcpServers": {
    "banxuebang": {
      "command": "node",
      "args": ["/absolute/path/banxuebang/scripts/mcp.mjs"],
      "env": {"BXB_AGENT_DATA_DIR":"/absolute/path/private-bxb-data"}
    }
  }
}
```

Use the receiving host's supported configuration format. This package does not register itself globally or change another agent's configuration. MCP stdout contains only protocol messages; startup diagnostics go to stderr. All catalog tools are registered. Code previews, rendered PDF pages, and image preview/read calls include MCP image blocks so the agent can inspect pixels.

## Maintaining the Source Snapshot

In the source repository, run:

```text
node release/scripts/sync-agent-skill.mjs
node release/scripts/sync-agent-skill.mjs --check
python release/scripts/package-agent-skill.py
```

The synchronizer copies an explicit list of shared runtime files and the license, preserves the locked root dependencies, and regenerates the complete tool catalog. `runtime-manifest.json` records hashes of the included source files and original dependency lock. Do not edit the generated runtime or catalogs independently; change the backend or adapter first, then synchronize.

The packager writes `release/artifacts/agent-skills/banxuebang-<version>.zip` and its SHA-256 sidecar from an explicit source-file allowlist. It excludes installed dependencies, browser caches, sessions, drafts, and workspace data. The receiving machine installs dependencies after extracting the package.

The standalone adapters live in `scripts/extra-tools.mjs`. They expose code rendering and workspace/document operations used by agents without a desktop window. Desktop update installers and the desktop chat loop are application services rather than Banxuebang tool definitions and are not started by the standalone runtime.
