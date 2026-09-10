import { createInterface } from "node:readline";
import { findCommandByMcpName, getAllMcpTools } from "../command-registry.ts";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export async function runMcpServer(repoRoot: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  const sendResponse = (res: JsonRpcResponse) => {
    process.stdout.write(JSON.stringify(res) + "\n");
  };

  rl.on("line", async (line) => {
    if (!line.trim()) return;
    try {
      const req = JSON.parse(line) as JsonRpcRequest;
      if (!req || req.jsonrpc !== "2.0") return;

      if (req.method === "initialize") {
        return sendResponse({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "ia-graft-mcp", version: "0.2.0" },
          },
        });
      }

      if (req.method === "notifications/initialized") {
        return;
      }

      if (req.method === "tools/list") {
        return sendResponse({
          jsonrpc: "2.0",
          id: req.id,
          result: { tools: getAllMcpTools() },
        });
      }

      if (req.method === "tools/call") {
        const params = req.params as { name?: string; arguments?: Record<string, unknown> };
        const toolName = params?.name;
        const args = params?.arguments ?? {};

        if (!toolName) {
          return sendResponse({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32602, message: "Missing tool name in params" },
          });
        }

        const cmd = findCommandByMcpName(toolName);
        if (!cmd) {
          return sendResponse({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32601, message: `Unknown tool: ${toolName}` },
          });
        }

        try {
          const toolResult = await cmd.handler(repoRoot, args);
          return sendResponse({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(toolResult, null, 2),
                },
              ],
            },
          });
        } catch (execErr) {
          return sendResponse({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: false,
                    error: execErr instanceof Error ? execErr.message : String(execErr),
                  }),
                },
              ],
            },
          });
        }
      }

      sendResponse({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
    } catch (err) {
      sendResponse({
        jsonrpc: "2.0",
        error: { code: -32700, message: `Parse error: ${err instanceof Error ? err.message : String(err)}` },
      });
    }
  });
}
