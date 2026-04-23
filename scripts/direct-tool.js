import { ZodError } from "zod/v4";
import { BanxuebangClient } from "../src/banxuebang-client.js";
import { SessionStore } from "../src/session-store.js";
import { createToolDefinitions, executeTool } from "../src/tool-definitions.js";

function printUsage() {
  console.error(
    "Usage: node scripts/direct-tool.js <tool_name> [json_args | key=value ...]\n" +
      "Calls BanxuebangClient directly without MCP.\n" +
      'Example: node scripts/direct-tool.js session_status\n' +
      'Example: node scripts/direct-tool.js set_current_subject \'{"subject_name":"国际公民素养"}\'\n' +
      "Example: node scripts/direct-tool.js set_current_term term_name=2025-2026下学期",
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
try {
  args = parseArgs(rawArgs);
} catch (error) {
  console.error(`Failed to parse args: ${error.message}`);
  printUsage();
  process.exit(1);
}

const client = new BanxuebangClient(new SessionStore());
const toolDefinitions = createToolDefinitions(client);

try {
  const result = await executeTool(toolDefinitions, toolName, args);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof ZodError) {
    console.error(JSON.stringify(error.issues, null, 2));
  } else {
    console.error(error?.stack || String(error));
  }
  process.exit(1);
}
