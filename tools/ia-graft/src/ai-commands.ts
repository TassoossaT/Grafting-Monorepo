import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CliError } from "./task-commands.ts";

const execFileAsync = promisify(execFile);
type ExecFile = typeof execFileAsync;

const fail = (error: string): CliError => ({ ok: false, error });

const TIERS = ["low", "medium", "high"] as const;
type Tier = (typeof TIERS)[number];

export interface AiRunInput {
  prompt: string;
  tier?: Tier;
}

/**
 * Delegates a single headless prompt to Gemini 3.6 Flash via the `agy` CLI
 * (a multi-provider AI CLI installed separately from this repo). Array args
 * to `execFile` keep the prompt as one argv element, so it can't break out
 * into shell metacharacters.
 */
export async function aiRun(repoRoot: string, input: AiRunInput, { exec = execFileAsync }: { exec?: ExecFile } = {}) {
  if (!input?.prompt?.trim()) return fail("prompt is required");
  const tier = input.tier ?? "high";
  if (!TIERS.includes(tier)) return fail(`invalid tier: ${tier}`);
  const model = `gemini-3.6-flash-${tier}`;
  try {
    const { stdout } = await exec("agy", ["-p", input.prompt, "--model", model, "--output-format", "text"], { cwd: repoRoot });
    return { ok: true as const, output: stdout.trim(), model };
  } catch (error) {
    return fail(`agy run failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
