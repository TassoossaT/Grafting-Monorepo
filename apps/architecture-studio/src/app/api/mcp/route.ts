import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./server.ts";

// Node.js runtime explicitly (not Edge): MCP's real transports assume a
// Node process, per ADR-0016. Stateless mode (`sessionIdGenerator:
// undefined`) -- each HTTP request is one independently processable
// JSON-RPC exchange, matching how a Next.js Route Handler is actually
// invoked (no guaranteed single long-lived connection to pin a session to).
export const runtime = "nodejs";

async function handle(request: Request): Promise<Response> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export { handle as DELETE, handle as GET, handle as POST };
