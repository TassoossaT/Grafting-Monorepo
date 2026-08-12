import { delegateEdit } from "./delegate-edit-commands.ts";
import type { Effort } from "./delegate-profiles.ts";
import type { CliError } from "./task-commands.ts";

const fail = (error: string): CliError => ({ ok: false, error });

export interface DelegateResearchInput {
  taskId: string;
  /** What to research. Kept separate from a free-form `prompt` on purpose -- this command is deliberately narrower than `delegate edit`. */
  topic: string;
  /** Where to save the researched Markdown, e.g. "docs/research/foo.md". Must end in .md. */
  outputFile: string;
  effort?: Effort;
}

/**
 * Fixed prompt template evidence-tested against real `agy` calls (see
 * `reference_gemini_web_research_findings` in project memory): grounded
 * search over guessing, broad topics decomposed into targeted searches
 * per sub-topic, and a fixed Markdown shape so the result is directly
 * usable as a file, not prose that still needs reformatting.
 */
function buildResearchPrompt(topic: string, outputFile: string): string {
  return [
    "Research the following topic using web search. Use your search/read-URL tools to verify current facts -- never answer from memory for version numbers, dates, or anything that could have changed recently.",
    "If the topic is broad or has multiple parts, decompose it into separate targeted searches per sub-topic rather than one shallow search.",
    `Write ONLY the researched content, as Markdown, to the file "${outputFile}". Do not touch any other file. Do not include any commentary outside that file.`,
    "Structure the file as: a single \"#\" title line, a short intro paragraph, 3-6 \"##\" sections with bullet points, and a final \"## Sources\" section listing every URL actually consulted.",
    "",
    `Topic: ${topic}`,
  ].join("\n");
}

/**
 * A thin, research-specific wrapper over `delegateEdit`: same worktree
 * isolation, out-of-scope revert, and content-loss signal, but with three
 * differences that matter for research specifically, over just calling
 * `delegate run`/`delegate edit` by hand:
 * - the prompt is fixed and evidence-tested, not composed per call (cheaper
 *   for the caller, and consistently well-shaped output);
 * - `.ai/INDEX.md` auto-grounding is skipped -- this repo's context map is
 *   irrelevant to an external research topic, so there's no reason to pay
 *   for it;
 * - `scope` is automatically pinned to `outputFile` alone, so a research
 *   call can never touch anything else in the worktree;
 * - Gemini writes the `.md` file itself, so there is no separate
 *   text-to-file conversion step (and its attendant formatting risk) on
 *   the caller's side.
 */
export async function delegateResearch(repoRoot: string, input: DelegateResearchInput, deps?: Parameters<typeof delegateEdit>[2]) {
  if (!input?.topic?.trim()) return fail("topic is required");
  if (!input?.outputFile?.trim()) return fail("outputFile is required");
  if (!input.outputFile.endsWith(".md")) return fail(`outputFile must end in .md: ${input.outputFile}`);

  return delegateEdit(
    repoRoot,
    {
      taskId: input.taskId,
      prompt: buildResearchPrompt(input.topic, input.outputFile),
      effort: input.effort ?? "medium",
      scope: [input.outputFile],
      groundInRepoContext: false,
    },
    deps,
  );
}
