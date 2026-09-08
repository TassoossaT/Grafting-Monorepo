import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("MCP server handles initialize, tools/list, and tools/call over stdio JSON-RPC", async () => {
  const binPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "bin.ts");

  const child = spawn(process.execPath, ["--experimental-strip-types", binPath, "mcp"], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses: any[] = [];
  const rl = createInterface({ input: child.stdout });

  rl.on("line", (line) => {
    if (line.trim()) {
      responses.push(JSON.parse(line));
    }
  });

  const send = (req: Record<string, unknown>) => {
    child.stdin.write(JSON.stringify(req) + "\n");
  };

  // 1. Initialize request
  send({ jsonrpc: "2.0", id: 1, method: "initialize" });

  // 2. Initialized notification
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  // 3. Tools list request
  send({ jsonrpc: "2.0", id: 2, method: "tools/list" });

  // 4. Tools call for graft_doc_check
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "graft_doc_check", arguments: {} } });

  // Wait for all 3 responses
  for (let i = 0; i < 50; i += 1) {
    if (responses.length >= 3) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  child.stdin.end();
  await new Promise<void>((resolve) => child.on("close", () => resolve()));

  assert.equal(responses.length, 3, "expected 3 JSON-RPC responses");

  // Verify initialize response
  const initRes = responses.find((r) => r.id === 1);
  assert.ok(initRes, "must receive response for initialize");
  assert.equal(initRes.result.serverInfo.name, "ia-graft-mcp");

  // Verify tools/list response
  const listRes = responses.find((r) => r.id === 2);
  assert.ok(listRes, "must receive response for tools/list");
  const toolNames = listRes.result.tools.map((t: any) => t.name);
  assert.ok(toolNames.includes("graft_task_done"), "tools/list must include graft_task_done");
  assert.ok(toolNames.includes("graft_pr_checks"), "tools/list must include graft_pr_checks");
  assert.ok(toolNames.includes("graft_issue_tree"), "tools/list must include graft_issue_tree");
  assert.ok(toolNames.includes("graft_context_pack"), "tools/list must include graft_context_pack");

  // Verify tools/call response
  const callRes = responses.find((r) => r.id === 3);
  assert.ok(callRes, "must receive response for tools/call");
  const parsed = JSON.parse(callRes.result.content[0].text);
  assert.equal(parsed.passed, true, "graft_doc_check should pass");
});
