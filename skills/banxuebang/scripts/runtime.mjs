import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile } from "node:fs/promises";

export const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function supportedNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 19);
}

export function dataPaths() {
  const base = process.env.BXB_AGENT_DATA_DIR || (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "bxb-agent")
    : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support", "bxb-agent")
      : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "bxb-agent"));
  const root = path.resolve(base);
  return {
    root,
    sessionFile: path.resolve(process.env.BANXUEBANG_SESSION_FILE || path.join(root, "session.json")),
    draftDir: path.resolve(process.env.BANXUEBANG_DRAFT_DIR || path.join(root, "drafts")),
    workspaceDir: path.resolve(process.env.BANXUEBANG_WORKSPACE_DIR || path.join(root, "workspace")),
  };
}

export async function catalog() {
  return JSON.parse(await readFile(path.join(skillRoot, "references", "tools.json"), "utf8"));
}

export async function createRuntime() {
  if (!supportedNode()) throw new Error("Node.js 22.19 or newer is required by the locked dependencies; prefer the version in .nvmrc.");
  const paths = dataPaths();
  process.env.BANXUEBANG_SESSION_FILE = paths.sessionFile;
  process.env.BANXUEBANG_DRAFT_DIR = paths.draftDir;
  process.env.BANXUEBANG_WORKSPACE_DIR = paths.workspaceDir;
  const [{ BanxuebangClient }, { SessionStore }, { DraftStore }, { createToolDefinitions, executeTool },
    { extraToolDefinitions }, { AcademicContextCoordinator }] = await Promise.all([
    import("../runtime/banxuebang-client.js"), import("../runtime/session-store.js"),
    import("../runtime/draft-store.js"), import("../runtime/tool-definitions.js"),
    import("./extra-tools.mjs"), import("../runtime/academic-context-coordinator.js"),
  ]);
  const client = new BanxuebangClient(new SessionStore(paths.sessionFile), new DraftStore(paths.draftDir));
  const tools = [...createToolDefinitions(client), ...extraToolDefinitions(client)];
  const coordinator = new AcademicContextCoordinator();
  const changesContext = new Set(["interactive_login", "login_in_browser", "login_with_credentials",
    "import_browser_storage", "clear_session", "set_current_term", "set_current_subject"]);
  return { client, tools, paths, call: (name, args = {}) => {
    const operation = async () => {
      if (name === "browser_capture_achievement_page" && !args.screenshot_path) {
        await mkdir(path.join(paths.root, "screenshots"), { recursive: true });
        args = { ...args, screenshot_path: path.join(paths.root, "screenshots", "achievement-page.png") };
      }
      return executeTool(tools, name, args);
    };
    return changesContext.has(name) ? coordinator.runSwitch(operation) : coordinator.runOperation(operation);
  } };
}
