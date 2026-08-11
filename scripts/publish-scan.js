import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const riskyPaths = [
  {
    path: ".banxuebang/session.json",
    reason: "saved Banxuebang session with tokens and personal account context",
  },
  {
    path: ".banxuebang/downloads",
    reason: "downloaded attachments from a real student account",
  },
  {
    path: ".playwright-cli",
    reason: "local Playwright debug output",
  },
  {
    path: "artifacts",
    reason: "local screenshots and submission test files",
  },
  {
    path: "app.bundle.js",
    reason: "reverse-engineered third-party frontend bundle that should not ship with the repo",
  },
  {
    path: "vendors.bundle.js",
    reason: "reverse-engineered third-party vendor bundle that should not ship with the repo",
  },
];

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const findings = [];

for (const item of riskyPaths) {
  const resolvedPath = path.join(repoRoot, item.path);
  if (await exists(resolvedPath)) {
    findings.push({
      path: item.path,
      reason: item.reason,
    });
  }
}

if (findings.length === 0) {
  console.log("Publish scan passed. No known local-only sensitive or debug paths were found.");
  process.exit(0);
}

console.error("Publish scan failed. Remove or keep ignoring these local-only paths before publishing:");
for (const finding of findings) {
  console.error(`- ${finding.path}: ${finding.reason}`);
}
process.exit(1);
