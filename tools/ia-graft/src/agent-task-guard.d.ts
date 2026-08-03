declare module "../../scripts/agent-task-guard.mjs" {
  export interface GuardDecision {
    allowed: boolean;
    reason: string;
  }

  export interface HookInput {
    hook_event_name: "PreToolUse";
    tool_name: string;
    tool_input: Record<string, unknown>;
  }

  export function evaluateHook(args: {
    root: string;
    agent: string;
    hookInput: HookInput;
  }): Promise<GuardDecision>;

  export function normalizeRepositoryPath(root: string, candidate: unknown): string | null;
  export function isHarnessManagedPath(candidate: unknown): boolean;
  export function isReadOnlyInspectionCommand(command: unknown): boolean;
  export function evaluateAgentGitCommand(command: unknown): GuardDecision;
}
