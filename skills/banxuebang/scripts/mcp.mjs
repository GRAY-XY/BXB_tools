#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createRuntime } from "./runtime.mjs";

async function imageContent(result, name) {
  const candidates = [];
  if (name === "read_workspace_image" || name === "preview_submission_draft_attachment") {
    if (result.dataUrl) candidates.push(result.dataUrl);
  } else if (name === "render_code_as_vscode_image") {
    for (const file of result.images || []) candidates.push(`data:image/png;base64,${(await readFile(file.path)).toString("base64")}`);
  } else if (name === "render_pdf_pages") {
    for (const file of result.pages || []) candidates.push(`data:image/png;base64,${(await readFile(file.path)).toString("base64")}`);
  }
  return candidates.map(url => {
    const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(url);
    if (!match) throw new Error("Invalid image response.");
    return { type: "image", mimeType: match[1], data: match[2] };
  });
}

try {
  const [{ McpServer }, { StdioServerTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"), import("@modelcontextprotocol/sdk/server/stdio.js"),
  ]);
  const runtime = await createRuntime();
  const server = new McpServer({ name: "banxuebang-agent-skill", version: "1.0.0" });
  for (const tool of runtime.tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, async args => {
      try {
        const result = await runtime.call(tool.name, args);
        const images = await imageContent(result, tool.name);
        const json = JSON.stringify(result, (key, value) => key === "dataUrl" ? undefined : value);
        return { content: [{ type: "text", text: json }, ...images] };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: error.message }) }] };
      }
    });
  }
  await server.connect(new StdioServerTransport());
  console.error(`Banxuebang MCP ready: ${runtime.tools.length} tools.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
