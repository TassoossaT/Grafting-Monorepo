import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_REGISTRY,
  commandToMcpTool,
  findCommandByCliRoute,
  findCommandByMcpName,
  getAllMcpTools,
} from "./command-registry.ts";

test("COMMAND_REGISTRY contains complete, valid command definitions", () => {
  assert.ok(COMMAND_REGISTRY.length >= 25, `expected at least 25 registered commands, got ${COMMAND_REGISTRY.length}`);

  for (const cmd of COMMAND_REGISTRY) {
    assert.ok(cmd.name.startsWith("graft_"), `command name ${cmd.name} should start with 'graft_'`);
    assert.ok(cmd.group && cmd.group.length > 0, `command ${cmd.name} must have a group`);
    assert.ok(cmd.description && cmd.description.length > 5, `command ${cmd.name} must have a descriptive summary`);
    assert.equal(typeof cmd.handler, "function", `command ${cmd.name} must have an executable handler`);

    // Verify parameter schemas
    for (const [paramName, paramDef] of Object.entries(cmd.parameters)) {
      assert.ok(["string", "number", "boolean", "array", "object"].includes(paramDef.type), `invalid type ${paramDef.type} for ${cmd.name}.${paramName}`);
      assert.ok(paramDef.description && paramDef.description.length > 0, `parameter ${cmd.name}.${paramName} must have description`);
    }
  }
});

test("getAllMcpTools returns valid MCP tool schemas for all commands and legacy aliases", () => {
  const mcpTools = getAllMcpTools();
  assert.ok(mcpTools.length >= COMMAND_REGISTRY.length, "MCP tools count must be >= registry count");

  // Verify backward-compatible legacy tools required by AGENTS.md
  const requiredLegacyTools = [
    "graft_context_pack",
    "graft_task_resume",
    "graft_task_status",
    "graft_task_commit",
    "graft_task_test",
  ];

  for (const legacyName of requiredLegacyTools) {
    const found = mcpTools.find((t) => t.name === legacyName);
    assert.ok(found, `legacy MCP tool '${legacyName}' must be exposed for backward compatibility`);
    assert.ok(found.description, `tool '${legacyName}' must have a description`);
    assert.equal(found.inputSchema.type, "object", `tool '${legacyName}' inputSchema must be object`);
  }

  // Verify new command families are fully exposed
  const requiredNewTools = [
    "graft_task_done",
    "graft_task_sync",
    "graft_task_deps",
    "graft_pr_list",
    "graft_pr_view",
    "graft_pr_checks",
    "graft_pr_diff",
    "graft_issue_list",
    "graft_issue_view",
    "graft_issue_new",
    "graft_issue_close",
    "graft_issue_reopen",
    "graft_issue_tree",
    "graft_issue_doctor",
    "graft_doc_check",
    "graft_guard_check",
  ];

  for (const toolName of requiredNewTools) {
    const found = mcpTools.find((t) => t.name === toolName);
    assert.ok(found, `new MCP tool '${toolName}' must be automatically exposed in tools/list`);
  }
});

test("findCommandByCliRoute maps every CLI group/subcommand route to its command definition", () => {
  assert.equal(findCommandByCliRoute("task", "done")?.name, "graft_task_done");
  assert.equal(findCommandByCliRoute("task", "new")?.name, "graft_task_new");
  assert.equal(findCommandByCliRoute("task", "sync")?.name, "graft_task_sync");
  assert.equal(findCommandByCliRoute("pr", "checks")?.name, "graft_pr_checks");
  assert.equal(findCommandByCliRoute("pr", "diff")?.name, "graft_pr_diff");
  assert.equal(findCommandByCliRoute("issue", "tree")?.name, "graft_issue_tree");
  assert.equal(findCommandByCliRoute("issue", "doctor")?.name, "graft_issue_doctor");
  assert.equal(findCommandByCliRoute("issue", "close")?.name, "graft_issue_close");
  assert.equal(findCommandByCliRoute("issue", "reopen")?.name, "graft_issue_reopen");
  assert.equal(findCommandByCliRoute("context")?.name, "graft_context");
  assert.equal(findCommandByCliRoute("doc-check")?.name, "graft_doc_check");
  assert.equal(findCommandByCliRoute("guard-check")?.name, "graft_guard_check");
  assert.equal(findCommandByCliRoute("delegate", "run")?.name, "graft_delegate_run");
  assert.equal(findCommandByCliRoute("unknown", "route"), undefined);
});

test("findCommandByMcpName resolves commands by primary name and aliases", () => {
  assert.equal(findCommandByMcpName("graft_task_done")?.group, "task");
  assert.equal(findCommandByMcpName("graft_context_pack")?.group, "context");
  assert.equal(findCommandByMcpName("graft_context")?.group, "context");
  assert.equal(findCommandByMcpName("unknown_tool"), undefined);
});

test("commandToMcpTool produces valid JSON schema with required fields and types", () => {
  const taskDoneCmd = findCommandByCliRoute("task", "done")!;
  assert.ok(taskDoneCmd);
  const tool = commandToMcpTool(taskDoneCmd);

  assert.equal(tool.name, "graft_task_done");
  assert.equal(tool.inputSchema.type, "object");
  const props = tool.inputSchema.properties as Record<string, { type: string; description: string }>;
  assert.equal(props.taskId?.type, "string");
  assert.equal(props.title?.type, "string");
  assert.equal(props.body?.type, "string");

  const required = tool.inputSchema.required as string[];
  assert.ok(required.includes("taskId"));
  assert.ok(required.includes("title"));
  assert.ok(required.includes("body"));
  assert.ok(!required.includes("base"));
});
