import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DELEGATE_PROFILES, EFFORTS, type Effort } from "./delegate-profiles.ts";
import type { CliError } from "./task-commands.ts";

const execFileAsync = promisify(execFile);
type ExecFile = typeof execFileAsync;

const fail = (error: string): CliError => ({ ok: false, error });

/** Signals from a provider CLI that mean "out of quota/credits", not a bug to fix in code. */
const QUOTA_EXHAUSTED_PATTERN = /quota|rate.?limit|\b429\b|insufficient.*credit|exceeded.*(?:limit|quota)/i;

export interface DelegateRunInput {
  prompt: string;
  effort?: Effort;
}

/**
 * Delegates a single headless prompt at a given effort level. The effort
 * is the entire public contract -- which model/provider/CLI actually
 * backs it lives in `delegate-profiles.ts`.
 */
export async function delegateRun(repoRoot: string, input: DelegateRunInput, { exec = execFileAsync }: { exec?: ExecFile } = {}) {
  if (!input?.prompt?.trim()) return fail("prompt is required");
  const effort = input.effort ?? "high";
  const profile = DELEGATE_PROFILES[effort];
  if (!profile) return fail(`invalid effort: ${effort} (expected one of: ${EFFORTS.join(", ")})`);
  try {
    const { stdout } = await exec(profile.cli, profile.buildArgs(input.prompt), { cwd: repoRoot });
    return { ok: true as const, output: stdout.trim(), effort, model: profile.label };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (QUOTA_EXHAUSTED_PATTERN.test(detail)) {
      return fail(`${profile.label} looks out of quota/credits (${detail}); repoint effort "${effort}" at a different model in delegate-profiles.ts`);
    }
    return fail(`delegate run failed: ${detail}`);
  }
}
