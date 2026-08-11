/**
 * The one seam between `ia-graft delegate run` and whatever CLI/model
 * currently backs it. Renaming a provider's CLI, bumping a model version,
 * adding a new effort level, or repointing an effort at a different vendor
 * entirely (e.g. because a plan ran out of credits) is a change to this
 * file only -- `bin.ts` and `delegate-commands.ts` never reference
 * "gemini" or "agy" directly.
 */

export type Effort = "low" | "medium" | "high";

export interface DelegateCallOptions {
  outputFormat: "text" | "json";
  /** Pre-stringified JSON schema, when structured output was requested. */
  jsonSchema?: string;
}

export interface DelegateProfile {
  /** Human-readable identity of the backing model, surfaced in results/errors. */
  label: string;
  /** Binary invoked via execFile -- args are always passed as an array, never shell-interpolated. */
  cli: string;
  /** Builds argv for a single headless prompt call (`delegate run`, text/JSON out, no filesystem writes). */
  buildArgs: (prompt: string, options: DelegateCallOptions) => string[];
  /**
   * Builds argv for a file-editing agent session (`delegate edit`). Only
   * edit tools are auto-approved (`--mode accept-edits`); everything else
   * (shell, browser, ...) still requires interactive approval and is
   * auto-denied in headless mode. This is not a substitute for the
   * caller always pinning `cwd` to an isolated task worktree and
   * post-hoc scope enforcement -- live testing showed the agent can still
   * wander into touching files outside the intended scope.
   */
  buildEditArgs: (prompt: string) => string[];
}

/** All current profiles share one CLI (`agy`) and only differ by model id. */
function agyProfile(model: string): DelegateProfile {
  return {
    label: model,
    cli: "agy",
    buildArgs: (prompt, { outputFormat, jsonSchema }) => {
      const args = ["-p", prompt, "--model", model, "--output-format", outputFormat];
      if (jsonSchema) args.push("--json-schema", jsonSchema);
      return args;
    },
    buildEditArgs: (prompt) => ["-p", prompt, "--model", model, "--mode", "accept-edits", "--sandbox", "--output-format", "json"],
  };
}

export const DELEGATE_PROFILES: Record<Effort, DelegateProfile> = {
  low: agyProfile("gemini-3.6-flash-low"),
  medium: agyProfile("gemini-3.6-flash-medium"),
  high: agyProfile("gemini-3.6-flash-high"),
};

export const EFFORTS = Object.keys(DELEGATE_PROFILES) as Effort[];
