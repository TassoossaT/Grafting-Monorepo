import { evaluateHook } from "../../scripts/agent-task-guard.mjs";

export interface GuardCheckInput {
  agent: string;
  tool: "Write" | "Edit" | "Bash";
  path?: string;
  command?: string;
}

/**
 * Gives an agent a deterministic yes/no for a prospective tool call before it
 * spends a real Write/Edit/Bash attempt discovering the guard's rules through
 * a failure. Delegates to the exact same evaluateHook the PreToolUse hook
 * runs, so the verdict here and the real enforcement can never disagree.
 */
export async function runGuardCheck(repoRoot: string, input: GuardCheckInput) {
  const toolInput: Record<string, unknown> =
    input.tool === "Bash" ? { command: input.command ?? "" } : { file_path: input.path ?? "" };
  const decision = await evaluateHook({
    root: repoRoot,
    agent: input.agent,
    hookInput: { hook_event_name: "PreToolUse", tool_name: input.tool, tool_input: toolInput },
  });
  return { ok: true as const, allowed: decision.allowed, reason: decision.reason };
}
