import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BanxuebangClient } from "./banxuebang-client.js";
import { SessionStore } from "./session-store.js";
import { createToolDefinitions } from "./tool-definitions.js";

const server = new McpServer({
  name: "banxuebang-achievement-mcp",
  version: "0.1.0",
});

const client = new BanxuebangClient(new SessionStore());
const toolDefinitions = createToolDefinitions(client);

function jsonResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

for (const tool of toolDefinitions) {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (args) => jsonResult(await tool.execute(args)),
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("banxuebang-achievement-mcp running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
