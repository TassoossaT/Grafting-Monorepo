import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { DELEGATE_PROFILES, EFFORTS, type Effort } from "./delegate-profiles.ts";
import { GitClient } from "./git-client.ts";
import { isValidTaskId, taskContext, type CliError } from "./task-commands.ts";

const execFileAsync = promisify(execFile);
type ExecFile = typeof execFileAsync;

const fail = (error: string): CliError => ({ ok: false, error });

/** Below this fraction of pre-call word count surviving, flag possible content loss instead of staying silent about it. */
const CONTENT_LOSS_THRESHOLD = 0.7;
/** Caps the auto-grounding prompt overhead, independent of how large .ai/INDEX.md grows. */
const MAX_AUTO_CONTEXT_CHARS = 6000;

export interface DelegateEditInput {
  taskId: string;
  prompt: string;
  effort?: Effort;
  /** Path prefixes the edit is allowed to touch (e.g. ["docs/"]). Any changed file outside this is reverted, not silently kept. */
  scope?: string[];
  /**
   * Extra grounding prepended ON TOP OF the automatic `.ai/INDEX.md`
   * grounding below -- for something INDEX.md wouldn't cover. Usually
   * leave this unset: composing it costs the CALLER's own tokens (e.g.
   * Claude's, when Claude is the one invoking this), which undercuts the
   * whole point of delegating work to a cheaper model in the first place.
   */
  context?: string;
  /**
   * Set false to skip the automatic `.ai/INDEX.md` grounding entirely.
   * Default true. This repo's own context map is irrelevant overhead for
   * a task that isn't about this repo -- e.g. delegated web research --
   * and skipping it keeps the prompt smaller and cheaper for no loss.
   */
  groundInRepoContext?: boolean;
}

/**
 * Grounds the prompt in this repo's own `.ai/INDEX.md` -- an index file
 * literally written to be "the LLM context map & router" for this repo --
 * automatically and at zero cost to the caller: a plain file read, no LLM
 * involved. `agy` runs as an independent process with no built-in
 * awareness of Claude Code's hooks, AGENTS.md/PROTOCOL.md, or `ia-graft
 * context`; without this, it would have no repo grounding at all unless
 * the caller composed some by hand every time.
 */
async function autoGroundingContext(repoRoot: string): Promise<string | undefined> {
  const { summary } = await taskContext(repoRoot, {});
  if (!summary || summary.startsWith("No context found")) return undefined;
  return summary.slice(0, MAX_AUTO_CONTEXT_CHARS);
}

function inScope(path: string, scope?: string[]): boolean {
  if (!scope || scope.length === 0) return true;
  return scope.some((prefix) => path === prefix || path.startsWith(prefix));
}

interface PorcelainEntry {
  status: string;
  path: string;
}

/**
 * `git status --porcelain` lines are `XY path` or `XY old -> new` for
 * renames. Every call site passes `--untracked-files=all`: without it, git
 * collapses a WHOLE new untracked directory into one `?? dir/` entry
 * instead of listing the files inside -- found live when a delegated edit
 * created a file inside a not-yet-existing subdirectory (`docs/research/`)
 * and the collapsed `docs/` entry didn't match the file-level scope, so it
 * was wrongly treated as out-of-scope and `git clean`ed away, taking the
 * actually-wanted file down with the whole directory.
 */
function parsePorcelain(porcelain: string): PorcelainEntry[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.length > 3)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3).split(" -> ").pop()!.trim() }));
}

/**
 * Captures the working tree's pre-call state so an out-of-scope revert can
 * restore to it, not to HEAD. Restoring straight to HEAD is wrong whenever
 * the caller had its own uncommitted work in a tracked file the delegated
 * edit also happened to touch -- `git checkout HEAD -- <path>` would erase
 * that uncommitted work along with the delegated one, which is exactly the
 * failure this snapshot exists to prevent. `git stash create` builds a
 * commit object of the current index+worktree diff without touching the
 * worktree itself; an empty result means the tree was already clean, so
 * HEAD is an accurate baseline for tracked files in that case. The same
 * baseline also serves as the "before" text for the content-preservation
 * check below -- including for already-untracked files, whose actual
 * pre-call disk content is captured here too (`git stash create` does not
 * cover untracked files, so `beforeContent` is this function's only record
 * of what an untracked file looked like before the call).
 */
async function snapshotWorktree(worktreePath: string): Promise<{ before: Map<string, string>; beforeContent: Map<string, string>; baseline: string }> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: worktreePath });
  const statusEntries = parsePorcelain(stdout);
  const before = new Map(statusEntries.map((entry) => [entry.path, entry.status]));
  const beforeContent = new Map<string, string>();
  for (const entry of statusEntries) {
    if (entry.status !== "??") continue;
    beforeContent.set(entry.path, await readFile(join(worktreePath, entry.path), "utf8").catch(() => ""));
  }
  const { stdout: stashOut } = await execFileAsync("git", ["stash", "create"], { cwd: worktreePath });
  return { before, beforeContent, baseline: stashOut.trim() || "HEAD" };
}

async function readBaselineContent(worktreePath: string, baseline: string, path: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${baseline}:${path}`], { cwd: worktreePath });
    return stdout;
  } catch {
    return "";
  }
}

const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;
/** A single trailing newline (the common case for text files) must not count as an extra line. */
const countLines = (text: string): number => {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n$/, "");
  return normalized.length === 0 ? 0 : normalized.split("\n").length;
};

interface ChangedFileStat {
  path: string;
  status: "added" | "modified";
  linesBefore: number;
  linesAfter: number;
  wordsBefore: number;
  wordsAfter: number;
}

/**
 * Gives a delegated model real write access, but only inside an
 * already-isolated `ia-graft` task worktree -- never the main checkout --
 * and never auto-commits. Every prompt is automatically grounded in this
 * repo's `.ai/INDEX.md` (see `autoGroundingContext`) at zero cost to the
 * caller -- no need to hand-compose repo context before every call.
 * `scope`, when given, is enforced after the fact
 * against a pre-call snapshot: any changed file outside it is restored to
 * what it looked like right before this call (not silently kept, and not
 * blindly reset to HEAD -- see `snapshotWorktree`).
 *
 * The caller is not expected to re-read every changed file to gain
 * confidence: `changedFiles` carries per-file line/word before/after
 * counts, and `contentStats.possibleContentLoss` is a cheap, mechanical
 * (not LLM-judged) signal -- total post-call word count across every kept
 * file, divided by total pre-call word count of the ones that already
 * existed, flagged when it drops sharply. It catches gross content loss
 * (the failure mode actually observed in testing: the agent reporting
 * success while doing nothing, or trimming far more than asked) but not
 * subtle inaccuracy -- it is a signal to weigh, not a correctness proof.
 *
 * Known limitation: an already-untracked file that ends up OUT of scope is
 * left alone (not deleted) rather than restored, and its content is not
 * protected if the delegated edit modified it in place before the revert
 * decision -- `git stash create` does not snapshot untracked files, so
 * there is nothing to restore it FROM. In-scope untracked files don't have
 * this gap: their pre-call content is captured separately in
 * `snapshotWorktree`'s `beforeContent`, specifically so `contentStats`
 * stays accurate for them too, not just for already-tracked files.
 */
export async function delegateEdit(repoRoot: string, input: DelegateEditInput, { exec = execFileAsync }: { exec?: ExecFile } = {}) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (!input.prompt?.trim()) return fail("prompt is required");
  const effort = input.effort ?? "medium";
  const profile = DELEGATE_PROFILES[effort];
  if (!profile) return fail(`invalid effort: ${effort} (expected one of: ${EFFORTS.join(", ")})`);

  let worktreePath: string;
  try {
    const session = await new GitClient(repoRoot).openSession(input.taskId);
    worktreePath = session.worktreePath;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }

  const { before, beforeContent, baseline } = await snapshotWorktree(worktreePath);
  const autoContext = input.groundInRepoContext === false ? undefined : await autoGroundingContext(repoRoot);
  const groundingParts = [autoContext, input.context].filter((part): part is string => Boolean(part));
  const fullPrompt = groundingParts.length > 0 ? `${groundingParts.join("\n\n---\n\n")}\n\n---\n\n${input.prompt}` : input.prompt;

  let response: { status?: string; response?: string };
  try {
    const { stdout } = await exec(profile.cli, profile.buildEditArgs(fullPrompt, worktreePath), { cwd: worktreePath });
    response = JSON.parse(stdout);
  } catch (error) {
    return fail(`delegate edit failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const { stdout: porcelain } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: worktreePath });
  const entries = parsePorcelain(porcelain);

  const revertedOutOfScope: string[] = [];
  for (const entry of entries) {
    if (inScope(entry.path, input.scope)) continue;
    if (entry.status === "??") {
      if (before.has(entry.path)) continue; // pre-existing untracked file: not this call's to manage or delete
      await execFileAsync("git", ["clean", "-f", "--", entry.path], { cwd: worktreePath }).catch(() => undefined);
    } else {
      await execFileAsync("git", ["checkout", baseline, "--", entry.path], { cwd: worktreePath }).catch(() => undefined);
    }
    revertedOutOfScope.push(entry.path);
  }

  const kept = entries.filter((entry) => !revertedOutOfScope.includes(entry.path));
  const changedFiles: ChangedFileStat[] = [];
  for (const entry of kept) {
    // A currently-tracked path (post-call status isn't "??") necessarily
    // existed at `baseline` -- read it from there unconditionally. A
    // currently-untracked path either pre-existed untracked (captured in
    // `beforeContent`) or is genuinely new to this call; the pre-call
    // `before` status map (not the post-call one) is what tells them apart.
    const preExistedUntracked = before.get(entry.path) === "??";
    const status: "added" | "modified" = entry.status === "??" && !preExistedUntracked ? "added" : "modified";
    const beforeText =
      entry.status !== "??" ? await readBaselineContent(worktreePath, baseline, entry.path) : preExistedUntracked ? (beforeContent.get(entry.path) ?? "") : "";
    const afterText = await readFile(join(worktreePath, entry.path), "utf8").catch(() => "");
    changedFiles.push({
      path: entry.path,
      status,
      linesBefore: countLines(beforeText),
      linesAfter: countLines(afterText),
      wordsBefore: countWords(beforeText),
      wordsAfter: countWords(afterText),
    });
  }

  const totalWordsBefore = changedFiles.reduce((sum, file) => sum + file.wordsBefore, 0);
  const totalWordsAfter = changedFiles.reduce((sum, file) => sum + file.wordsAfter, 0);
  const retentionRatio = totalWordsBefore === 0 ? null : Number((totalWordsAfter / totalWordsBefore).toFixed(2));

  return {
    ok: true as const,
    taskId: input.taskId,
    worktreePath,
    effort,
    model: profile.label,
    agentStatus: response.status,
    summary: (response.response ?? "").trim(),
    changedFiles,
    revertedOutOfScope,
    contentStats: {
      totalWordsBefore,
      totalWordsAfter,
      retentionRatio,
      possibleContentLoss: retentionRatio !== null && retentionRatio < CONTENT_LOSS_THRESHOLD,
    },
  };
}
