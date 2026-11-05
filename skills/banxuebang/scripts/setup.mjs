#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { skillRoot, supportedNode } from "./runtime.mjs";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: skillRoot, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`Command failed with exit code ${code}.`)));
  });
}

try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--browser")) throw new Error("Usage: node scripts/setup.mjs [--browser]");
  if (!supportedNode()) throw new Error("Node.js 22.19 or newer is required. Use the release recorded in .nvmrc.");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // Launch npm's JS entry directly on Windows; this avoids shell quoting and .cmd spawn errors.
  const npmCli = process.platform === "win32" ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js") : null;
  if (npmCli) await run(process.execPath, [npmCli, "ci", "--no-audit", "--no-fund"]);
  else await run(npm, ["ci", "--no-audit", "--no-fund"]);
  if (args.includes("--browser")) {
    const require = createRequire(path.join(skillRoot, "package.json"));
    const cli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");
    await run(process.execPath, [cli, "install", "chromium"]);
  }
  console.log("Banxuebang skill dependencies are ready. Run scripts/bxb.mjs doctor next.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
