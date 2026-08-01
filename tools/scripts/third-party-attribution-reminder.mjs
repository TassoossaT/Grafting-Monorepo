import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MARKER_PATTERN = /Adapted from\s+(.+?)\s*\((https?:\/\/\S+?)\)/i;

const contentFrom = (hookInput) => {
  const toolInput = hookInput?.tool_input;
  if (!toolInput || typeof toolInput !== "object") return null;
  if (typeof toolInput.content === "string") return toolInput.content; // Write
  if (typeof toolInput.new_string === "string") return toolInput.new_string; // Edit
  return null;
};

/**
 * Advisory only: returns a reminder string when a Write/Edit introduces
 * content matching the "Adapted from <project> (<url>)" marker documented
 * in THIRD_PARTY_NOTICES.md, or null otherwise. A best-effort heuristic on
 * tool-call content, not semantic detection -- tools/scripts/
 * check-third-party-notices.mjs is the real, deterministic enforcement.
 */
export function reminderFor(hookInput) {
  if (!hookInput || hookInput.hook_event_name !== "PostToolUse") return null;
  const tool = hookInput.tool_name;
  if (tool !== "Write" && tool !== "Edit") return null;

  const content = contentFrom(hookInput);
  if (content === null) return null;
  const match = MARKER_PATTERN.exec(content);
  if (!match) return null;

  const project = match[1].trim();
  return (
    `This edit marks code as "Adapted from ${project}" -- confirm THIRD_PARTY_NOTICES.md has a ` +
    "matching entry (or add one), then run `node tools/scripts/check-third-party-notices.mjs` to verify."
  );
}

const readStandardInput = async () => {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return JSON.parse(input);
};

export async function main() {
  try {
    const reminder = reminderFor(await readStandardInput());
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
