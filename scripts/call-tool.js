import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.resolve(scriptDir, "..", "src", "index.js");

function printUsage() {
  console.error(
    "Usage: node scripts/call-tool.js <tool_name> [json_args | key=value ...]\n" +
      'Example: node scripts/call-tool.js session_status\n' +
      'Example: node scripts/call-tool.js set_current_subject \'{"subject_id":"c5029...","class_id":"8931..."}\'\n' +
      "Example: node scripts/call-tool.js set_current_subject subject_name=国际公民素养\n" +
      "Example: node scripts/call-tool.js set_current_term term_name=2025-2026下学期",
  );
}

function parseScalar(value) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (/^-?\d+$/.test(value)) {
    if (Math.abs(Number.parseInt(value, 10)) <= Number.MAX_SAFE_INTEGER && value.length < 16) {
      return Number.parseInt(value, 10);
    }

    return value;
  }

  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }

  return value;
}

function parseArgs(rawArgs) {
  if (rawArgs.length === 0) {
    return {};
  }

  if (rawArgs.length === 1) {
    const first = rawArgs[0].trim();
    if (first.startsWith("{") || first.startsWith("[")) {
      return JSON.parse(first);
    }
  }

  const parsed = {};
  for (const arg of rawArgs) {
    const separatorIndex = arg.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid argument "${arg}". Expected key=value.`);
    }

    const key = arg.slice(0, separatorIndex);
    const value = arg.slice(separatorIndex + 1);
    parsed[key] = parseScalar(value);
  }

  return parsed;
}

const [, , toolName, ...rawArgs] = process.argv;

if (!toolName) {
  printUsage();
  process.exit(1);
}

let args = {};
if (rawArgs.length > 0) {
  try {
    args = parseArgs(rawArgs);
  } catch (error) {
    console.error(`Failed to parse args: ${error.message}`);
    printUsage();
    process.exit(1);
  }
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
});

const client = new Client({
  name: "banxuebang-local-cli",
  version: "0.1.0",
});

try {
  await client.connect(transport);
  const result = await client.callTool({
    name: toolName,
    arguments: args,
  });

  for (const item of result.content || []) {
    if (item.type === "text") {
      console.log(item.text);
    } else {
      console.log(JSON.stringify(item, null, 2));
    }
  }

  await client.close();
} catch (error) {
  console.error(error?.stack || String(error));
  process.exit(1);
}
