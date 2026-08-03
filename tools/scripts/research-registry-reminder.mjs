import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeRepositoryPath } from "./agent-task-guard.mjs";

const REGISTRY_PATH = "docs/research/RESEARCH-DECISIONS-REGISTRY.md";
const RESEARCH_DOC_PATTERN = /^docs\/research\/.+\.md$/;

const targetPathFrom = (hookInput) => {
  const toolInput = hookInput?.tool_input;
  return toolInput && typeof toolInput === "object" ? (toolInput.file_path ?? null) : null;
};

/**
 * Advisory only: returns a reminder string when a Write/Edit touches a
 * research document other than the registry itself, or null otherwise. Never
 * decides whether the edit is allowed -- PostToolUse cannot block a tool call
 * that already ran.
 */
export function reminderFor(root, hookInput) {
  if (!hookInput || hookInput.hook_event_name !== "PostToolUse") return null;
  const tool = hookInput.tool_name;
  if (tool !== "Write" && tool !== "Edit") return null;

  const target = normalizeRepositoryPath(root, targetPathFrom(hookInput));
  if (target === null) return null;
  if (!RESEARCH_DOC_PATTERN.test(target) || target === REGISTRY_PATH) return null;

  return (
    `This edit touched a research document (${target}). If a candidate's status changed ` +
    "(adopted, decided, in development, in review, standby/deferred, discarded, or reference " +
    `only), also update ${REGISTRY_PATH} so tool-adoption decisions stay consolidated in one place.`
  );
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
