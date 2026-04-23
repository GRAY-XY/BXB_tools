import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod/v4";
import { BanxuebangClient } from "../src/banxuebang-client.js";
import { SessionStore } from "../src/session-store.js";
import { createToolDefinitions, executeTool } from "../src/tool-definitions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const indexHtmlPath = path.join(repoRoot, "ui", "index.html");
const client = new BanxuebangClient(new SessionStore());
const toolDefinitions = createToolDefinitions(client);
const dangerousTools = new Set(["upload_submission_file", "submit_task_result"]);
const port = Number.parseInt(process.env.PORT || "4317", 10);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "GET" && url.pathname === "/") {
      const html = await readFile(indexHtmlPath, "utf8");
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(html);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/tools") {
      sendJson(
        response,
        200,
        toolDefinitions.map((tool) => ({
          name: tool.name,
          description: tool.description,
          dangerous: dangerousTools.has(tool.name),
        })),
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/tool") {
      const rawBody = await readBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const toolName = payload.tool_name;
      const args = payload.arguments || {};

      if (!toolName) {
        sendJson(response, 400, { error: "tool_name is required." });
        return;
      }

      if (dangerousTools.has(toolName) && payload.confirm !== true) {
        sendJson(response, 400, {
          error:
            "This tool performs a real upload or submission. Set confirm=true only after explicit user confirmation.",
        });
        return;
      }

      const result = await executeTool(toolDefinitions, toolName, args);
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: `Invalid JSON body: ${error.message}` });
      return;
    }

    if (error instanceof ZodError) {
      sendJson(response, 400, { error: "Validation failed.", issues: error.issues });
      return;
    }

    sendJson(response, 500, { error: error?.message || String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Banxuebang UI running at http://127.0.0.1:${port}`);
});
