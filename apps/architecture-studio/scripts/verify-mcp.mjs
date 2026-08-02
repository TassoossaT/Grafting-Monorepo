// Real end-to-end verification for ARCH-STUDIO-MCP-SDK-VALIDATION: connects
// to the app's own running /api/mcp Route Handler using the MCP SDK's real
// Client + StreamableHTTPClientTransport (not a mock), and calls the one
// real tool it exposes. Requires the dev server to already be running
// (`pnpm nx run architecture-studio:dev`).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const baseUrl = process.env.MCP_URL ?? "http://127.0.0.1:4511/api/mcp";

const client = new Client({ name: "verify-mcp-script", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(baseUrl));

await client.connect(transport);

const tools = await client.listTools();
console.log(`Tools available: ${tools.tools.map((tool) => tool.name).join(", ")}`);

const result = await client.callTool({
  name: "list_architecture_entities",
  arguments: { kind: "node", limit: 3 },
});

const text = result.content?.[0]?.text;
if (typeof text !== "string") {
  throw new Error("Expected the tool result's first content block to be text");
}
const payload = JSON.parse(text);

console.log("Tool result:", JSON.stringify(payload, null, 2));

if (typeof payload.graphId !== "string" || !Array.isArray(payload.nodes) || payload.nodes.length === 0) {
  throw new Error("Tool result did not contain the expected Graph IR shape");
}

console.log(`OK: real MCP round-trip succeeded, ${payload.nodes.length} node(s) returned from graph ${payload.graphId}`);

await client.close();
