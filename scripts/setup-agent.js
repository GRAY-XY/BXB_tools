import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const command = process.platform === "win32" ? "node" : "node";
const config = {
  mcpServers: {
    "banxuebang-achievement-mcp": {
      command,
      args: [path.join(cwd, "src", "index.js")],
      cwd,
    },
  },
};

const targetPath = path.join(cwd, "mcp.local.json");
await mkdir(path.dirname(targetPath), { recursive: true });
await writeFile(targetPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

console.log(`Wrote local MCP config to ${targetPath}`);
console.log("");
console.log("Use this file as a ready-to-paste config snippet for AI clients that support stdio MCP.");
console.log("If browser login or screenshots are needed, ensure Chromium is installed:");
console.log("  npx playwright install chromium");
