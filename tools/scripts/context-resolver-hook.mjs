// Automatic trigger for the context resolver (owner's explicit choice): when
// a task record is written/edited into `in_progress`, prints the resolved
// AGENTS.md/router/ADR digest for that task as a PostToolUse reminder, so an
// agent doesn't have to run tools/scripts/context-resolver.mjs by hand after
// every claim. Advisory only, same shape as doc-size-reminder.mjs and
// third-party-attribution-reminder.mjs: reads hook JSON from stdin, never
// blocks, never throws out of main().
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeRepositoryPath } from "./agent-task-guard.mjs";
import { resolveContext } from "./context-resolver.mjs";

// Matches agent-task-guard.mjs's own TASK_RECORD convention
// (.ai/state/tasks/<status>/<ID>.json) without importing its unexported const.
const TASK_RECORD_PATTERN = /^\.ai\/state\/tasks\/[a-z_]+\/([A-Z][A-Z0-9-]{2,63})\.json$/;

const targetPathFrom = (hookInput) => {
  const toolInput = hookInput?.tool_input;
  return toolInput && typeof toolInput === "object" ? (toolInput.file_path ?? null) : null;
};

/**
 * Advisory only: returns a resolved-context digest string when a Write/Edit
 * leaves a task record at status "in_progress", or null otherwise. Reads the
 * task record's current content fresh from disk (not tool_input, which for
 * Edit is only a diff) -- same approach as doc-size-reminder.mjs.
 *
 * Known, accepted limitation: this checks current resulting state, not a
 * before/after diff, so it re-fires on every subsequent edit to an
 * already-in_progress record (e.g. mid-task validations/artifacts updates),
 * not only on the initial claim -- matching this repo's existing
 * advisory-hook precedent rather than adding diff-based transition detection.
 */
export function reminderFor(root, hookInput, resolve_ = resolveContext) {
  if (!hookInput || hookInput.hook_event_name !== "PostToolUse") return null;
  const tool = hookInput.tool_name;
  if (tool !== "Write" && tool !== "Edit") return null;

  const target = normalizeRepositoryPath(root, targetPathFrom(hookInput));
  if (target === null || !TASK_RECORD_PATTERN.test(target)) return null;

  let record;
  try {
    record = JSON.parse(readFileSync(resolve(root, target), "utf8"));
  } catch {
    return null;
  }
  if (record?.status !== "in_progress" || typeof record.task_id !== "string") return null;

  try {
    return resolve_({ root, taskId: record.task_id });
  } catch {
    // Best-effort: a missing project-graph.json/master source/ADR index
    // must never surface as a hook failure -- just stay silent.
    return null;
  }
}

const readStandardInput = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
};

const parseArguments = (arguments_) => {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("expected --root <path>");
    values[key.slice(2)] = value;
  }
  return values;
};

export async function main(arguments_ = process.argv.slice(2)) {
  try {
    const options = parseArguments(arguments_);
    if (!options.root) throw new Error("usage: --root <path>");
    const reminder = reminderFor(options.root, await readStandardInput());
    if (reminder) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: reminder },
        }),
      );
    }
    return 0;
  } catch {
    // Advisory only: a malformed or unexpected hook invocation must never
    // surface as an error or affect the tool call that already completed.
    return 0;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
