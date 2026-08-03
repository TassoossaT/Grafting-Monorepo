import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeRepositoryPath } from "./agent-task-guard.mjs";
import { classifyDocSize, countLines, isAuthoredDoc } from "./doc-size.mjs";

const MARKDOWN_PATTERN = /\.md$/;

const targetPathFrom = (hookInput) => {
  const toolInput = hookInput?.tool_input;
  return toolInput && typeof toolInput === "object" ? (toolInput.file_path ?? null) : null;
};

/**
 * Advisory only: returns a reminder string when a Write/Edit leaves a
 * Markdown document "large" or "colossal" (thresholds in doc-size.mjs), or
 * null otherwise. Never decides whether the edit is allowed -- PostToolUse
 * cannot block a tool call that already ran. Reads the file's current
 * content directly rather than trusting tool_input, since Edit's own input
 * is a diff (old_string/new_string), not the resulting file.
 */
export function reminderFor(root, hookInput) {
  if (!hookInput || hookInput.hook_event_name !== "PostToolUse") return null;
  const tool = hookInput.tool_name;
  if (tool !== "Write" && tool !== "Edit") return null;

  const target = normalizeRepositoryPath(root, targetPathFrom(hookInput));
  if (target === null || !MARKDOWN_PATTERN.test(target) || !isAuthoredDoc(target)) return null;

  let lineCount;
  try {
    lineCount = countLines(readFileSync(resolve(root, target), "utf8"));
  } catch {
    return null;
  }

  const level = classifyDocSize(lineCount);
  if (level === "ok") return null;

  return (
    `${target} is now ${lineCount} lines (${level}). If this document is meant to be read in full ` +
    "before doing structural work, consider whether it should route readers to shorter linked " +
    "documents instead of growing further -- run `node tools/scripts/check-doc-organization.mjs` " +
    "for the full repository picture."
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
