import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
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
  /**
   * Path whose content is appended to the prompt, relative to the MAIN
   * checkout root (or absolute-but-inside-it) -- `bin.ts` always resolves
   * `repoRoot` to the main checkout, never a task worktree, even when this
   * command runs from inside one.
   */
  file?: string;
  /** When set, requests structured output matching this schema instead of free text. */
  jsonSchema?: Record<string, unknown>;
}

function resolveRepoFile(repoRoot: string, file: string): { absolute: string; relative: string } | { error: string } {
  const absolute = isAbsolute(file) ? resolvePath(file) : resolvePath(repoRoot, file);
  const rel = relative(repoRoot, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return { error: `file must be inside the repo: ${file}` };
  return { absolute, relative: rel };
}

/**
 * Delegates a single headless prompt at a given effort level. Effort,
 * optional file context, and optional output schema are the entire public
 * contract -- which model/provider/CLI actually backs it lives in
 * `delegate-profiles.ts`.
 */
export async function delegateRun(repoRoot: string, input: DelegateRunInput, { exec = execFileAsync }: { exec?: ExecFile } = {}) {
  if (!input?.prompt?.trim()) return fail("prompt is required");
  const effort = input.effort ?? "high";
  const profile = DELEGATE_PROFILES[effort];
  if (!profile) return fail(`invalid effort: ${effort} (expected one of: ${EFFORTS.join(", ")})`);

  let prompt = input.prompt;
  if (input.file) {
    const located = resolveRepoFile(repoRoot, input.file);
    if ("error" in located) return fail(located.error);
    let content: string;
    try {
      content = await readFile(located.absolute, "utf8");
    } catch (error) {
      return fail(`could not read file ${input.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    prompt = `${input.prompt}\n\n--- file: ${located.relative} ---\n${content}`;
  }

  const outputFormat = input.jsonSchema ? "json" : "text";
  const jsonSchema = input.jsonSchema ? JSON.stringify(input.jsonSchema) : undefined;

  try {
    const { stdout } = await exec(profile.cli, profile.buildArgs(prompt, { outputFormat, jsonSchema }), { cwd: repoRoot });
    if (outputFormat === "text") return { ok: true as const, output: stdout.trim(), effort, model: profile.label };

    let parsed: { status?: string; structured_output?: unknown };
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return fail(`${profile.label} did not return valid JSON for the requested schema`);
    }
    if (parsed.status !== "SUCCESS" || parsed.structured_output === undefined) {
      return fail(`${profile.label} did not return structured output matching the requested schema`);
    }
    return { ok: true as const, output: parsed.structured_output, effort, model: profile.label };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (QUOTA_EXHAUSTED_PATTERN.test(detail)) {
      return fail(`${profile.label} looks out of quota/credits (${detail}); repoint effort "${effort}" at a different model in delegate-profiles.ts`);
    }
    return fail(`delegate run failed: ${detail}`);
  }
}
