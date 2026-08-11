/**
 * The one seam between `ia-graft delegate run` and whatever CLI/model
 * currently backs it. Renaming a provider's CLI, bumping a model version,
 * adding a new effort level, or repointing an effort at a different vendor
 * entirely (e.g. because a plan ran out of credits) is a change to this
 * file only -- `bin.ts` and `delegate-commands.ts` never reference
 * "gemini" or "agy" directly.
 */

export type Effort = "low" | "medium" | "high";

export interface DelegateProfile {
  /** Human-readable identity of the backing model, surfaced in results/errors. */
  label: string;
  /** Binary invoked via execFile -- args are always passed as an array, never shell-interpolated. */
  cli: string;
  /** Builds argv for a single headless prompt call. */
  buildArgs: (prompt: string) => string[];
}

export const DELEGATE_PROFILES: Record<Effort, DelegateProfile> = {
  low: {
    label: "gemini-3.6-flash-low",
    cli: "agy",
    buildArgs: (prompt) => ["-p", prompt, "--model", "gemini-3.6-flash-low", "--output-format", "text"],
  },
  medium: {
    label: "gemini-3.6-flash-medium",
    cli: "agy",
    buildArgs: (prompt) => ["-p", prompt, "--model", "gemini-3.6-flash-medium", "--output-format", "text"],
  },
  high: {
    label: "gemini-3.6-flash-high",
    cli: "agy",
    buildArgs: (prompt) => ["-p", prompt, "--model", "gemini-3.6-flash-high", "--output-format", "text"],
  },
};

export const EFFORTS = Object.keys(DELEGATE_PROFILES) as Effort[];
