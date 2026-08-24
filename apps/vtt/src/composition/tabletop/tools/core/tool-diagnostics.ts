/**
 * What a tool says to the console when a commit goes wrong.
 *
 * A tool reports failure twice, to two different readers. `reportFeedback`
 * is for the person at the table: one sentence, in their language, saying
 * their stroke did not land. This is for whoever has to find out *why* --
 * the stage that threw, what it was given, and the stack.
 *
 * Worth having as its own seam rather than a bare `console.error` at each
 * call site. A commit is a sequence of transactions against the graph -- fit,
 * plan, edit, overlay, patch -- and every one of them can fail for reasons
 * that look identical from outside: one sentence about a region id, with
 * nothing to say which of five calls produced it. Naming the stage is most
 * of the diagnosis, and a stable prefix makes the whole sequence filterable
 * in the browser console.
 *
 * Generic on purpose. Nothing here knows about paths, walls or terrain; a
 * tool passes its own name and whatever few facts identify the attempt.
 */

/** The prefix every line carries, so a console filter finds the lot. */
export const TOOL_DIAGNOSTIC_PREFIX = "[construction]";

/**
 * Runs one stage of a commit, naming it if it throws.
 *
 * Rethrows: this reports, it does not decide. Whether a failed stage costs
 * the stroke or only part of it is the caller's judgement, and swallowing
 * here would take that judgement away -- and hide the failure, which is the
 * opposite of the point.
 */
export function inStage<T>(
  tool: string,
  stage: string,
  facts: Readonly<Record<string, unknown>>,
  run: () => T,
): T {
  try {
    return run();
  } catch (error) {
    reportToolFailure(tool, stage, facts, error);
    throw error;
  }
}

/** One failed stage, on the console, with everything known about it. */
export function reportToolFailure(
  tool: string,
  stage: string,
  facts: Readonly<Record<string, unknown>>,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  // Grouped rather than concatenated: the facts stay inspectable objects in
  // the browser console instead of becoming "[object Object]".
  console.error(`${TOOL_DIAGNOSTIC_PREFIX} ${tool}: ${stage} failed -- ${message}`, {
    tool,
    stage,
    ...facts,
    error,
  });
}

/** Something a commit survived but should not have had to. */
export function reportToolWarning(
  tool: string,
  stage: string,
  facts: Readonly<Record<string, unknown>>,
): void {
  console.warn(`${TOOL_DIAGNOSTIC_PREFIX} ${tool}: ${stage}`, { tool, stage, ...facts });
}
