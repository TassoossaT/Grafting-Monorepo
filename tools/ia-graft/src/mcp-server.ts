import { createInterface } from "node:readline";
import { taskCommit, taskContext, taskResume, taskStatus, taskTest } from "./task-commands.ts";

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

const TOOLS = [
  {
    name: "graft_context_pack",
    description: "Resolves a token-efficient context pack containing affected Nx projects, AGENTS.md rules, and applicable ADRs.",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "List of modified or target file paths" },
        taskId: { type: "string", description: "Target task ID" },
      },
    },
  },
  {
    name: "graft_task_resume",
    description: "Resumes or opens a task worktree and retrieves complete state recovery context (commits, diffs, dirty files, context pack).",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Target task ID (e.g. G-TOOLING-CONTEXT-PACK)" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "graft_task_status",
    description: "Checks health, branch, and worktree status for a task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Target task ID" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "graft_task_commit",
    description: "Stages and commits changes inside the specified task worktree.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Target task ID" },
        message: { type: "string", description: "Conventional commit message" },
        files: { type: "array", items: { type: "string" }, description: "Optional subset of files to commit" },
        amend: { type: "boolean", description: "Amend previous commit" },
        dryRun: { type: "boolean", description: "Validate input without making a commit" },
      },
      required: ["taskId", "message"],
    },
  },
  {
    name: "graft_task_test",
    description: "Runs verification command inside the specified task worktree.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "Target task ID" },
        command: { type: "string", description: "Command to execute (e.g. pnpm test)" },
      },
      required: ["taskId"],
    },
  },
];

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
            serverInfo: { name: "ia-graft-mcp", version: "0.1.0" },
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
          result: { tools: TOOLS },
        });
      }

      if (req.method === "tools/call") {
        const params = req.params as { name?: string; arguments?: Record<string, unknown> };
        const toolName = params?.name;
        const args = params?.arguments ?? {};

        let toolResult: unknown;

        if (toolName === "graft_context_pack") {
          toolResult = await taskContext(repoRoot, {
            pack: true,
            paths: Array.isArray(args.paths) ? (args.paths as string[]) : undefined,
            taskId: typeof args.taskId === "string" ? args.taskId : undefined,
          });
        } else if (toolName === "graft_task_resume") {
          toolResult = await taskResume(repoRoot, {
            taskId: String(args.taskId),
          });
        } else if (toolName === "graft_task_status") {
          toolResult = await taskStatus(repoRoot, {
            taskId: String(args.taskId),
          });
        } else if (toolName === "graft_task_commit") {
          toolResult = await taskCommit(repoRoot, {
            taskId: String(args.taskId),
            message: String(args.message),
            files: Array.isArray(args.files) ? (args.files as string[]) : undefined,
            amend: typeof args.amend === "boolean" ? args.amend : undefined,
            dryRun: typeof args.dryRun === "boolean" ? args.dryRun : typeof args.check === "boolean" ? args.check : undefined,
          });
        } else if (toolName === "graft_task_test") {
          toolResult = await taskTest(repoRoot, {
            taskId: String(args.taskId),
            command: typeof args.command === "string" ? args.command : undefined,
          });
        } else {
          return sendResponse({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32601, message: `Unknown tool: ${toolName}` },
          });
        }

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
