import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_REGISTRY,
  commandRoutes,
  commandToMcpTool,
  findCommandByCliRoute,
  findCommandByMcpName,
  getAllMcpTools,
  parameterFlags,
  routeLabel,
} from "./command-registry.ts";

/**
 * The parameter *shapes* are checked by the compiler, not here:
 * `defineCommand<TInput>` makes `parameters` a mapped type over the handler's
 * own input interface, so a missing field, an invented field, or a
 * required/optional mismatch fails `pnpm typecheck`. What is left for a test
 * is everything the type system cannot see -- naming, uniqueness, and the two
 * derived surfaces agreeing with the table (#260).
 */
test("every command is well-formed and describes itself", () => {
  assert.ok(COMMAND_REGISTRY.length >= 25, `expected at least 25 registered commands, got ${COMMAND_REGISTRY.length}`);

  for (const cmd of COMMAND_REGISTRY) {
    assert.ok(cmd.name.startsWith("graft_"), `command name ${cmd.name} should start with 'graft_'`);
    assert.ok(cmd.group.length > 0, `command ${cmd.name} must have a group`);
    assert.ok(cmd.description.length > 5, `command ${cmd.name} must have a descriptive summary`);
    assert.equal(typeof cmd.handler, "function", `command ${cmd.name} must have an executable handler`);

    for (const [key, spec] of Object.entries(cmd.parameters)) {
      assert.ok(
        ["string", "number", "boolean", "array", "object"].includes(spec.type),
        `invalid type ${spec.type} for ${cmd.name}.${key}`,
      );
      assert.ok(spec.description.length > 0, `parameter ${cmd.name}.${key} must have a description`);
      assert.ok(!(spec.mcpOnly && spec.positional), `${cmd.name}.${key} cannot be both MCP-only and positional`);
    }
  }
});

test("no MCP tool name and no CLI route is claimed twice", () => {
  const names = COMMAND_REGISTRY.map((cmd) => cmd.name);
  assert.equal(new Set(names).size, names.length, "duplicate MCP tool name in the registry");

  const routes = COMMAND_REGISTRY.flatMap((cmd) => commandRoutes(cmd).map(routeLabel));
  assert.equal(new Set(routes).size, routes.length, `duplicate CLI route in the registry: ${routes.join(", ")}`);
});

test("within a command, no two parameters answer to the same flag", () => {
  for (const cmd of COMMAND_REGISTRY) {
    const seen = new Map<string, string>();
    for (const [key, spec] of Object.entries(cmd.parameters)) {
      if (spec.mcpOnly) continue;
      for (const flag of parameterFlags(key, spec)) {
        const owner = seen.get(flag);
        assert.equal(owner, undefined, `${cmd.name}: ${flag} is claimed by both ${owner} and ${key}`);
        seen.set(flag, key);
      }
    }
    const positional = Object.entries(cmd.parameters).filter(([, spec]) => spec.positional);
    assert.ok(positional.length <= 1, `${cmd.name} declares more than one positional parameter`);
  }
});

/**
 * One tool per command, and no aliases. A second name for the same command is
 * a duplicate an agent has to choose between, and the heuristic that used to
 * tell `graft_context_pack` apart from `graft_context` guessed at intent from
 * which fields happened to be set.
 */
test("the MCP manifest is exactly one tool per registered command", () => {
  const tools = getAllMcpTools();
  assert.equal(tools.length, COMMAND_REGISTRY.length);
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    COMMAND_REGISTRY.map((cmd) => cmd.name).sort(),
  );

  for (const tool of tools) {
    assert.ok(tool.description.length > 0, `tool ${tool.name} must have a description`);
    assert.equal(tool.inputSchema.type, "object", `tool ${tool.name} inputSchema must be an object`);
  }
});

test("every MCP-required parameter is one the caller genuinely has to supply", () => {
  for (const cmd of COMMAND_REGISTRY) {
    const required = (commandToMcpTool(cmd).inputSchema.required as string[] | undefined) ?? [];
    for (const key of required) {
      const spec = cmd.parameters[key];
      assert.ok(spec, `${cmd.name} reports required parameter ${key} that it does not declare`);
      assert.equal(spec.required, true);
      assert.equal(spec.default, undefined, `${cmd.name}.${key} has a default, so it is not required`);
    }
    // A defaulted parameter is satisfiable without the caller even though the
    // handler's field is not optional.
    assert.ok(!required.includes("type") || cmd.name !== "graft_issue_new");
  }
});

test("findCommandByCliRoute maps every CLI route, including aliases, to its command", () => {
  assert.equal(findCommandByCliRoute("task", "done")?.name, "graft_task_done");
  assert.equal(findCommandByCliRoute("task", "new")?.name, "graft_task_new");
  assert.equal(findCommandByCliRoute("task", "sync")?.name, "graft_task_sync");
  assert.equal(findCommandByCliRoute("pr", "checks")?.name, "graft_pr_checks");
  assert.equal(findCommandByCliRoute("issue", "tree")?.name, "graft_issue_tree");
  assert.equal(findCommandByCliRoute("issue", "reopen")?.name, "graft_issue_reopen");
  assert.equal(findCommandByCliRoute("context")?.name, "graft_context");
  assert.equal(findCommandByCliRoute("task", "context")?.name, "graft_context");
  assert.equal(findCommandByCliRoute("doc-check")?.name, "graft_doc_check");
  assert.equal(findCommandByCliRoute("guard-check")?.name, "graft_guard_check");
  assert.equal(findCommandByCliRoute("delegate", "run")?.name, "graft_delegate_run");
  assert.equal(findCommandByCliRoute("unknown", "route"), undefined);
  assert.equal(findCommandByCliRoute("task"), undefined, "a group needing a subcommand must not match bare");
});

test("findCommandByMcpName resolves a command by its one and only tool name", () => {
  assert.equal(findCommandByMcpName("graft_task_done")?.group, "task");
  assert.equal(findCommandByMcpName("graft_context")?.group, "context");
  assert.equal(findCommandByMcpName("graft_context_pack"), undefined, "aliases are gone, not renamed");
  assert.equal(findCommandByMcpName("unknown_tool"), undefined);
});

test("commandToMcpTool produces a valid JSON schema with the right required fields", () => {
  const tool = commandToMcpTool(findCommandByCliRoute("task", "done")!);

  assert.equal(tool.name, "graft_task_done");
  assert.equal(tool.inputSchema.type, "object");
  const props = tool.inputSchema.properties as Record<string, { type: string; description: string }>;
  assert.equal(props.taskId?.type, "string");
  assert.equal(props.title?.type, "string");
  assert.equal(props.body?.type, "string");

  const required = tool.inputSchema.required as string[];
  assert.deepEqual(required.sort(), ["body", "taskId", "title"]);
});

/**
 * These were the concrete divergences the old hand-written schema carried
 * (#260). They are compile errors now, but a regression here would be a
 * silent one for MCP callers, so the exact fields stay asserted.
 */
test("the schemas that had drifted now match their handlers", () => {
  const propsOf = (name: string) =>
    Object.keys(commandToMcpTool(findCommandByMcpName(name)!).inputSchema.properties as object).sort();

  assert.deepEqual(propsOf("graft_issue_update"), ["body", "comment", "id", "priority", "reason", "state", "status"]);
  assert.deepEqual(propsOf("graft_issue_list"), ["area", "limit", "orphan", "parent", "priority", "status", "type"]);
  assert.deepEqual(propsOf("graft_pr_list"), ["limit", "state"]);
  assert.deepEqual(propsOf("graft_pr_diff"), ["id", "stat", "task"]);
  assert.deepEqual(propsOf("graft_delegate_run"), ["effort", "files", "jsonSchema", "prompt"]);
  assert.deepEqual(propsOf("graft_guard_check"), ["agent", "command", "path", "tool"]);
  assert.ok(propsOf("graft_task_new").includes("parent"));
  assert.ok(propsOf("graft_task_commit").includes("coAuthors"));
  assert.ok(propsOf("graft_issue_tree").includes("limit"));
  assert.ok(propsOf("graft_delegate_edit").includes("groundInRepoContext"));

  // `agent` is what made graft_guard_check uncallable: the handler requires
  // it and the manifest never mentioned it.
  const guard = commandToMcpTool(findCommandByMcpName("graft_guard_check")!);
  assert.ok((guard.inputSchema.required as string[]).includes("agent"));
});
