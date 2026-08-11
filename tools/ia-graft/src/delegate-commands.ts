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
/**
 * Combined char budget across every --file. This is NOT about Gemini's
 * context window (which is large) or cost -- the prompt travels as a
 * single argv element to `agy`, and Windows' CreateProcess has a hard
 * ~32,767-char ceiling on the ENTIRE command line. A real two-file call
 * (~44k chars of file content) failed with `spawn ENAMETOOLONG` well
 * before that model-side budget would ever matter. Kept well under the OS
 * ceiling to leave headroom for the prompt text, file delimiters, and the
 * rest of argv (--model, --output-format, ...). A clear failure here beats
 * a cryptic OS-level spawn error. If larger multi-file input is ever
 * needed, the fix is piping content to `agy` some other way, not raising
 * this constant -- the ceiling is the OS's, not ours to negotiate.
 *
 * The exact safe boundary isn't pinned down precisely -- the real failing
 * call above was 44,015 chars of file content, while a single real
 * ~23,000-char doc succeeded fine. This sits with margin below the known
 * failure point and above the known-good point; narrow it further if
 * ENAMETOOLONG resurfaces in practice.
 */
const MAX_COMBINED_FILE_CHARS = 28_000;

/**
 * `delegate run` also works for web research today, with no extra flags:
 * `agy`'s underlying Gemini session has a working `search_web` tool that
 * runs headlessly without permission prompts (confirmed by direct testing
 * -- unlike several other tools in its toolkit, which DO get auto-denied
 * in headless mode, see delegate-edit-commands.ts's docs). A prompt like
 * `delegate run --prompt "What is the current stable version of X? Use
 * web search, don't guess from memory."` triggers a real search and comes
 * back with a cited, current answer in a few seconds. Useful for
 * offloading research/fact-lookup that would otherwise spend the calling
 * agent's own search budget -- verify anything load-bearing, the same way
 * you would any other web result.
 */
export interface DelegateRunInput {
  prompt: string;
  effort?: Effort;
  /**
   * One or more paths whose content is appended to the prompt, each
   * relative to the MAIN checkout root (or absolute-but-inside-it) --
   * `bin.ts` always resolves `repoRoot` to the main checkout, never a task
   * worktree, even when this command runs from inside one. Combined
   * content is capped at `MAX_COMBINED_FILE_CHARS`.
   */
  files?: string[];
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
  if (input.files && input.files.length > 0) {
    const sections: string[] = [];
    let combinedChars = 0;
    for (const file of input.files) {
      const located = resolveRepoFile(repoRoot, file);
      if ("error" in located) return fail(located.error);
      let content: string;
      try {
        content = await readFile(located.absolute, "utf8");
      } catch (error) {
        return fail(`could not read file ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
      combinedChars += content.length;
      sections.push(`--- file: ${located.relative} ---\n${content}`);
    }
    if (combinedChars > MAX_COMBINED_FILE_CHARS) {
      return fail(`combined --file content is ${combinedChars} chars, over the ${MAX_COMBINED_FILE_CHARS}-char limit for one delegate run -- split across multiple calls`);
    }
    prompt = `${input.prompt}\n\n${sections.join("\n\n")}`;
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
