#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { catalog, createRuntime, dataPaths, skillRoot, supportedNode } from "./runtime.mjs";

const usage = "Usage: node scripts/bxb.mjs list | describe <tool> | doctor | call <tool> [--args-file <file> | --stdin | <json-object>]";
const print = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

try {
  const [command, name, ...input] = process.argv.slice(2);
  if (!command || command === "--help") { console.log(usage); }
  else if (command === "list" && !name) {
    const { tools } = await catalog();
    print({ count: tools.length, tools: tools.map(({ name, description, effect }) => ({ name, description, effect })) });
  } else if (command === "describe" && name && !input.length) {
    const tool = (await catalog()).tools.find(item => item.name === name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    print(tool);
  } else if (command === "doctor" && !name) {
    const paths = dataPaths();
    const require = createRequire(path.join(skillRoot, "package.json"));
    const dependencies = {};
    for (const dependency of ["zod", "playwright", "pdf-parse", "@napi-rs/canvas", "@modelcontextprotocol/sdk/server/mcp.js"]) {
      try {
        const resolved = require.resolve(dependency);
        const relative = path.relative(path.join(skillRoot, "node_modules"), resolved);
        dependencies[dependency] = { available: true, installedInPackage: !!relative && !relative.startsWith("..") && !path.isAbsolute(relative) };
      } catch { dependencies[dependency] = { available: false, installedInPackage: false }; }
    }
    let sessionFileExists = false;
    try { await access(paths.sessionFile); sessionFileExists = true; } catch { /* No session is a valid fresh state. */ }
    const ready = supportedNode()
      && Object.values(dependencies).every(item => item.available && item.installedInPackage);
    print({ ready, nodeVersion: process.version, skillRoot, paths, dependencies, sessionFileExists,
      note: "Checks local files only. Browser, Python, network access, and account validity are not probed." });
    if (!ready) process.exitCode = 1;
  } else if (command === "call" && name) {
    let text = "{}";
    if (input[0] === "--args-file" && input.length === 2) text = await readFile(path.resolve(input[1]), "utf8");
    else if (input[0] === "--stdin" && input.length === 1) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      text = Buffer.concat(chunks).toString("utf8");
    } else if (input.length === 1) text = input[0];
    else if (input.length) throw new Error(usage);
    const args = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments must be a JSON object.");
    const runtime = await createRuntime();
    print(await runtime.call(name, args));
  } else throw new Error(usage);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) })}\n`);
  process.exitCode = 1;
}
