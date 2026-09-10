import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runDocCheck } from "./doc-check.ts";
import { issueView } from "./issue.ts";
import { GitClient } from "../git/client.ts";
import { dependencyMode, mirrorGeneratedArtifacts } from "../git/dependencies.ts";

export interface CliError {
  ok: false;
  error: string;
  [key: string]: unknown;
}

const fail = (error: string): CliError => ({ ok: false, error });
const MAX_BATCH_COMMANDS = 12;
const MAX_BATCH_SUMMARY_CHARS = 1_500;

function compactBatchSummary(summary: string): string {
  if (summary.length <= MAX_BATCH_SUMMARY_CHARS) return summary;
  const marker = "\n...[batch result truncated]...\n";
  const side = Math.floor((MAX_BATCH_SUMMARY_CHARS - marker.length) / 2);
  return `${summary.slice(0, side)}${marker}${summary.slice(-side)}`;
}

const TASK_ID_PATTERN = /^[A-Z][A-Z0-9-]{2,63}$/;

export function isValidTaskId(taskId: string): boolean {
  return TASK_ID_PATTERN.test(taskId);
}

export interface TaskNewInput {
  taskId: string;
  base?: string;
  parent?: string;
}

/**
 * Creates an isolated worktree + branch for a task. No status, no JSON record.
 * It prepares workspace-aware dependency overlays when the main checkout has
 * an installation to reuse, and reports the missing-install case explicitly.
 *
 * Sweeps merged-PR worktrees first, silently and best-effort -- nobody
 * calling this needs to know that happens, and a sweep failure (e.g. `gh`
 * unreachable) never blocks creating the task that was actually asked for.
 */
export async function taskNew(repoRoot: string, input: TaskNewInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  const client = new GitClient(repoRoot);
  await client.sweepMergedWorktrees().catch(() => undefined);
  if (input.parent && !isValidTaskId(input.parent)) return fail(`invalid parent task id: ${input.parent}`);
  const { session, resumed, repaired, base, parent, dependencies } = await client.createOrResumeSession(input.taskId, {
    base: input.base,
    parentTaskId: input.parent,
  });
  return {
    ok: true as const,
    worktreePath: session.worktreePath,
    branch: session.branchName,
    nodeModulesLinked: session.nodeModulesLinked,
    resumed,
    repaired,
    base,
    parent,
    dependencyMode: dependencies.mode,
    dependencyOverlays: dependencies.overlays,
    workspaceLinks: dependencies.workspaceLinks,
    dependenciesMaterialized: dependencies.materialized ?? false,
    dependencyLockfileHash: dependencies.lockfileHash,
    dependencyWorkspaceConfigHash: dependencies.workspaceConfigHash,
    dependencyVirtualStore: dependencies.virtualStore,
    dependencyReason: dependencies.reason,
  };
}

export const KNOWN_AI_COAUTHORS: Record<string, string> = {
  gemini: "Gemini <gemini@google.com>",
  claude: "Claude <claude@anthropic.com>",
  codex: "Codex <codex@openai.com>",
  openai: "Codex <codex@openai.com>",
  copilot: "GitHub Copilot <copilot@github.com>",
};

export function resolveCoAuthor(input: string): string {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (KNOWN_AI_COAUTHORS[lower]) return KNOWN_AI_COAUTHORS[lower];
  if (trimmed.includes("<") && trimmed.includes(">")) return trimmed;
  return `${trimmed} <${lower.replace(/\s+/g, ".")}@ai.grafting.dev>`;
}

export function formatCommitMessageWithCoAuthors(message: string, coAuthors?: string[], agent?: string): string {
  const all = [
    ...(agent ? [agent] : []),
    ...(coAuthors ?? []),
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);

  if (all.length === 0) return message;

  const resolved = all.map(resolveCoAuthor);
  const trailers = resolved
    .map((author) => `Co-authored-by: ${author}`)
    .filter((trailer) => !message.includes(trailer));

  if (trailers.length === 0) return message;

  const trimmed = message.trimEnd();
  const hasExistingTrailers = /Co-authored-by:[^\n]+$/i.test(trimmed);
  const separator = hasExistingTrailers ? "\n" : "\n\n";

  return `${trimmed}${separator}${trailers.join("\n")}\n`;
}

export interface TaskCommitInput {
  taskId: string;
  message: string;
  files?: string[];
  coAuthors?: string[];
  agent?: string;
  amend?: boolean;
  dryRun?: boolean;
  generateDocs?: boolean;
}

/** Stages (all files, or a given subset) and commits inside the task's worktree. */
export async function taskCommit(repoRoot: string, input: TaskCommitInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (!input.message) return fail("message is required");
  const messageWithCoAuthors = formatCommitMessageWithCoAuthors(input.message, input.coAuthors, input.agent);
  if (input.dryRun) {
    return {
      ok: true as const,
      dryRun: true as const,
      formattedMessage: messageWithCoAuthors,
      amend: input.amend ?? false,
    };
  }
  const client = new GitClient(repoRoot);
  const session = await client.openSession(input.taskId);
  const unmerged = await session.unmergedPaths();
  const marked = await session.conflictMarkerPaths(unmerged);
  if (marked.length > 0) return { ok: false as const, error: "conflict markers remain in unresolved files", conflicts: marked };

  const agentsMd = join(session.worktreePath, "AGENTS.md");
  if (existsSync(agentsMd)) {
    const docCheck = await runDocCheck(session.worktreePath);
    if (!docCheck.passed) {
      const failures = docCheck.checks.filter((c) => !c.passed).map((c) => `${c.file}: ${c.reason}`).join("; ");
      return fail(`doc-check failed: ${failures}`);
    }
  }

  if (input.generateDocs) {
    await mirrorGeneratedArtifacts(repoRoot, session.worktreePath);
    const pkgJsonPath = join(session.worktreePath, "package.json");
    if (existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
      if (pkg.scripts?.["docs:generate"]) {
        const genResult = await session.runTests("pnpm run docs:generate");
        if (!genResult.passed) return fail(`pre-commit docs:generate failed: ${genResult.summary}`);
        await session.add("docs/generated");
      }
    }
  }

  await session.add(input.files && input.files.length > 0 ? input.files : ".");
  const remaining = await session.unmergedPaths();
  if (remaining.length > 0) return { ok: false as const, error: "unresolved merge conflicts remain", conflicts: remaining };
  await session.commit(messageWithCoAuthors, input.amend);
  return { ok: true as const, amended: input.amend ?? false };
}

export interface TaskTestInput {
  taskId: string;
  command?: string;
  commands?: string[];
  keepGoing?: boolean;
}

/**
 * Runs a test/check command inside the task's worktree and returns a
 * compact pass/fail summary instead of raw output -- spend tokens on the
 * result, not the transcript.
 */
export async function taskTest(repoRoot: string, input: TaskTestInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (input.command && input.commands?.length) return fail("command and commands are mutually exclusive");
  const commands = input.commands?.length ? input.commands : input.command ? [input.command] : [];
  if (commands.length === 0) return fail("at least one command is required");
  if (commands.some((command) => typeof command !== "string" || command.trim().length === 0)) return fail("every command must be a non-empty string");
  if (commands.length > MAX_BATCH_COMMANDS) return fail(`a test batch may contain at most ${MAX_BATCH_COMMANDS} commands`);
  const forbidden = commands.find((command) => /\b(?:pnpm|npm|yarn|bun)\s+(?:install|add|remove|update|upgrade|ci)\b/i.test(command));
  if (forbidden) {
    return fail("dependency-mutating commands are forbidden in task worktrees; run installs in the main checkout, then task deps --id <ID>");
  }
  const client = new GitClient(repoRoot);
  const session = await client.openSession(input.taskId);
  const results: Array<{ command: string; passed: boolean; summary: string }> = [];
  for (const command of commands) {
    const result = await session.runTests(command);
    results.push({ command, passed: result.passed, summary: commands.length > 1 ? compactBatchSummary(result.summary) : result.summary });
    if (!result.passed && !input.keepGoing) break;
  }
  if (commands.length === 1) return { ok: true as const, passed: results[0]!.passed, summary: results[0]!.summary };
  const passed = results.length === commands.length && results.every((result) => result.passed);
  return {
    ok: true as const,
    passed,
    summary: `${results.filter((result) => result.passed).length}/${commands.length} commands passed`,
    results,
  };
}

export interface TaskDoneInput {
  taskId: string;
  title: string;
  body: string;
  base?: string;
  skipDocGen?: boolean;
}

/**
 * Pushes the task's branch and opens a pull request. Leaves the worktree in place for
 * review follow-up. Automatically validates doc-check, mirrors generated artifacts,
 * runs docs:generate, and commits fresh derived artifacts for CI before pushing.
 * If `gh` is unavailable or fails, the push still happens and the result names a manual
 * compare URL instead of failing the whole call.
 */
export async function taskDone(repoRoot: string, input: TaskDoneInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  if (!input.title || !input.body) return fail("title and body are required");
  const client = new GitClient(repoRoot);
  const session = await client.openSession(input.taskId);
  const base = await client.resolveTaskBase(input.taskId, input.base);

  const unmerged = await session.unmergedPaths();
  const marked = await session.conflictMarkerPaths(unmerged);
  if (marked.length > 0) return { ok: false as const, error: "conflict markers remain in unresolved files", conflicts: marked };

  // Validate instruction size limits (doc-check) if instruction files are present in the worktree
  const agentsMd = join(session.worktreePath, "AGENTS.md");
  if (existsSync(agentsMd)) {
    const docCheck = await runDocCheck(session.worktreePath);
    if (!docCheck.passed) {
      const failures = docCheck.checks.filter((c) => !c.passed).map((c) => `${c.file}: ${c.reason}`).join("; ");
      return fail(`doc-check failed before PR push: ${failures}`);
    }
  }

  // Pre-commit hook: ensure gitignored generated workspace artifacts are mirrored into the worktree
  await mirrorGeneratedArtifacts(repoRoot, session.worktreePath);

  // Pre-commit hook: automatically run docs:generate if workspace script is present BEFORE committing
  let docsRegenerated = false;
  let docsCommitted = false;
  const pkgJsonPath = join(session.worktreePath, "package.json");
  if (existsSync(pkgJsonPath) && !input.skipDocGen) {
    try {
      const pkg = JSON.parse(await readFile(pkgJsonPath, "utf8"));
      if (pkg.scripts?.["docs:generate"]) {
        const genResult = await session.runTests("pnpm run docs:generate");
        if (!genResult.passed) {
          return fail(`automatic docs:generate failed before PR push: ${genResult.summary}`);
        }
        docsRegenerated = true;

        // Verify artifact manifest check passes
        if (pkg.scripts?.["graph:manifest:check"]) {
          const manifestCheck = await session.runTests("pnpm run graph:manifest:check");
          if (!manifestCheck.passed) {
            return fail(`graph:manifest:check failed: ${manifestCheck.summary}`);
          }
        }
      }
    } catch (error) {
      return fail(`error during docs regeneration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Pre-commit hook: stage and commit all dirty changes (feature files + freshly generated docs) in ONE unified commit
  const dirty = (await session.git(["status", "--porcelain"])).trim();
  if (dirty.length > 0) {
    const nonDocsDirty = (await session.git(["status", "--porcelain", "--", ":!docs/generated"])).trim();
    const headSha = (await session.git(["rev-parse", "HEAD"])).trim();
    const baseSha = (await session.git(["rev-parse", base])).trim();
    const hasCommitsOnBranch = headSha !== baseSha;

    if (nonDocsDirty.length === 0 && hasCommitsOnBranch) {
      // Pre-commit amend: fold newly generated docs directly into the last commit on the task branch
      await session.add("docs/generated");
      const lastMsg = (await session.git(["log", "-1", "--format=%B"])).trim();
      await session.commit(lastMsg, true);
      docsCommitted = true;
    } else {
      // Unified single commit: stage feature files and generated docs together
      await session.add(".");
      await session.commit(input.title);
      docsCommitted = docsRegenerated;
    }
  }

  await session.push();
  const pr = await session.createPullRequest(input.title, input.body, base);
  return {
    ok: true as const,
    prUrl: pr.url,
    prState: pr.state,
    base,
    docsRegenerated,
    docsCommitted,
    // Reported on every call, so a caller never has to open GitHub to find out
    // whether the prose it just wrote actually landed.
    bodyAppended: pr.bodyAppended ?? pr.state === "created",
    titleUpdated: pr.titleUpdated ?? pr.state === "created",
    note: pr.state === "manual" ? `branch pushed; open the PR manually at prUrl (${pr.reason})` : undefined,
  };
}

export interface TaskCleanupInput {
  taskId: string;
  force?: boolean;
}

/** Removes a merged task's worktree/local branch and prunes its verified, unused remote branch. */
export async function taskCleanup(repoRoot: string, input: TaskCleanupInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  const client = new GitClient(repoRoot);
  const result = await client.cleanupTask(input.taskId, input.force ?? false);
  return { ok: true as const, ...result };
}

export interface TaskStatusInput {
  taskId: string;
}

export async function taskStatus(repoRoot: string, input: TaskStatusInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  return { ok: true as const, ...(await new GitClient(repoRoot).taskStatus(input.taskId)) };
}

export interface TaskDoctorInput {
  taskId: string;
}

export async function taskDoctor(repoRoot: string, input: TaskDoctorInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  const diagnosis = await new GitClient(repoRoot).taskStatus(input.taskId);
  const dependenciesReady = diagnosis.dependencyMode === "workspace-aware";
  const healthy = diagnosis.checkoutMode === "worktree" && diagnosis.issues.length === 0
    && !diagnosis.mergeInProgress && dependenciesReady;
  const recommendedAction = diagnosis.mergeInProgress && diagnosis.syncSource ? "resolve conflicts, then task commit; or task sync --abort"
    : diagnosis.mergeInProgress ? "resolve conflicts, then task commit"
    : diagnosis.dependencyMode === "legacy-shared" ? "task deps --id <ID>"
    : diagnosis.dependencyMode === "unmanaged" ? "inspect unmanaged node_modules before task deps"
    : diagnosis.dependencyMode === "none" ? "install dependencies in main, then task deps --id <ID>"
    : healthy ? "none"
    : diagnosis.orphanDirectory ? "task new --id <ID>"
    : diagnosis.checkoutMode === "main" ? "task checkout --restore"
    : "task new --id <ID>";
  return { ok: true as const, healthy, dependenciesReady, ...diagnosis, recommendedAction };
}

export interface TaskDependenciesInput {
  taskId: string;
  install?: boolean;
  updateLockfile?: boolean;
  add?: string;
  workspace?: string;
  dev?: boolean;
}

export async function taskDependencies(repoRoot: string, input: TaskDependenciesInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  return {
    ok: true as const,
    ...(await new GitClient(repoRoot).prepareTaskDependencies(input.taskId, {
      install: input.install,
      updateLockfile: input.updateLockfile,
      add: input.add,
      workspace: input.workspace,
      dev: input.dev,
    })),
  };
}

export interface TaskSyncInput {
  taskId: string;
  fetch?: boolean;
  abort?: boolean;
}

export async function taskSync(repoRoot: string, input: TaskSyncInput) {
  if (!input || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  return { ok: true as const, ...(await new GitClient(repoRoot).syncTask(input.taskId, { fetch: input.fetch, abort: input.abort })) };
}

export interface TaskResumeInput {
  taskId?: string;
  pr?: number;
}

export async function taskResume(repoRoot: string, input: TaskResumeInput = {}) {
  let taskId = input.taskId;
  let prNumber = input.pr;
  const client = new GitClient(repoRoot);

  if (!taskId && prNumber !== undefined) {
    if (!Number.isInteger(prNumber) || prNumber <= 0) return fail(`invalid PR number: ${prNumber}`);
    const prResult = await client.resumeFromPullRequest(prNumber);
    taskId = prResult.taskId;
  }

  if (!taskId || !isValidTaskId(taskId)) {
    return fail(`invalid or missing task id: ${taskId ?? "(none)"}`);
  }

  const result = await client.createOrResumeSession(taskId);
  const worktreePath = result.session.worktreePath;
  const base = result.base;

  let recentCommits: string[] = [];
  let dirtyFiles: string[] = [];
  let affectedFiles: string[] = [];

  if (worktreePath && existsSync(worktreePath)) {
    try {
      const output = execFileSync("git", ["log", "-n", "3", "--oneline"], { cwd: worktreePath, encoding: "utf8" });
      recentCommits = output.split(/\r?\n/).filter(Boolean);
    } catch { /* no commits yet */ }

    try {
      const output = execFileSync("git", ["status", "--porcelain"], { cwd: worktreePath, encoding: "utf8" });
      dirtyFiles = output.split(/\r?\n/).filter(Boolean).map((line) => line.trim());
    } catch { /* clean */ }

    try {
      const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: worktreePath, encoding: "utf8" });
      affectedFiles = output.split(/\r?\n/).filter(Boolean);
    } catch { /* no diff */ }
  }

  let contextPack: string | undefined;
  try {
    // @ts-ignore - dynamic import of context-resolver.mjs script
    const { resolveContext } = await import("../../../scripts/context-resolver.mjs");
    contextPack = resolveContext({
      root: repoRoot,
      taskId: taskId,
      paths: affectedFiles.length > 0 ? affectedFiles : null,
    });
  } catch {
    contextPack = undefined;
  }

  return {
    ok: true as const,
    taskId,
    branch: result.session.branchName,
    worktreePath: result.session.worktreePath,
    resumed: result.resumed,
    repaired: result.repaired,
    base: result.base,
    pr: prNumber,
    recentCommits,
    dirtyFiles,
    affectedFiles,
    contextPack,
    dependencyMode: result.dependencies.mode,
    dependencyOverlays: result.dependencies.overlays,
    workspaceLinks: result.dependencies.workspaceLinks,
    dependenciesMaterialized: result.dependencies.materialized ?? false,
    dependencyLockfileHash: result.dependencies.lockfileHash,
    dependencyWorkspaceConfigHash: result.dependencies.workspaceConfigHash,
    dependencyVirtualStore: result.dependencies.virtualStore,
  };
}

export interface TaskCheckoutInput {
  taskId?: string;
  restore?: boolean;
  force?: boolean;
}

export async function taskCheckout(repoRoot: string, input: TaskCheckoutInput) {
  const client = new GitClient(repoRoot);
  if (input?.restore) return { ok: true as const, ...(await client.restoreCheckout(input.force ?? false)) };
  if (!input?.taskId || !isValidTaskId(input.taskId)) return fail(`invalid task id: ${input?.taskId}`);
  return { ok: true as const, taskId: input.taskId, ...(await client.checkoutTask(input.taskId)) };
}

export async function taskGraph(repoRoot: string) {
  const client = new GitClient(repoRoot);
  const defaultBranch = await client.resolveDefaultBranch();
  return { ok: true as const, defaultBranch, tasks: await client.taskGraph() };
}

/**
 * Sweeps every worktree under `.worktrees/`, cleans up (worktree + local
 * branch) the ones whose PR is already merged, and leaves everything else
 * untouched. Worktrees stop accumulating without anyone having to remember
 * to run `task cleanup` by hand after every merge.
 */
export async function taskSweep(repoRoot: string) {
  const client = new GitClient(repoRoot);
  const { cleaned, skipped, remoteBranches } = await client.sweepMergedWorktrees();
  return { ok: true as const, cleaned, skipped, remoteBranches };
}

export interface TaskContextInput {
  query?: string;
  scope?: string;
  pack?: boolean;
  taskId?: string;
  paths?: string[];
}

export async function taskContext(repoRoot: string, input: TaskContextInput = {}) {
  if (input.pack || input.taskId || (input.paths && input.paths.length > 0)) {
    let packSummary: unknown = null;
    try {
      // @ts-ignore - dynamic import of context-resolver.mjs script
      const { resolveContext } = await import("../../../scripts/context-resolver.mjs");
      packSummary = resolveContext({
        root: repoRoot,
        taskId: input.taskId ?? null,
        paths: input.paths ?? null,
      });
    } catch {
      packSummary = null;
    }

    let issueContext:
      | {
          id: number;
          title: string;
          type?: string;
          milestone?: string;
          parent?: { number: number; title: string };
        }
      | undefined;

    const issueMatch = input.taskId?.match(/^TASK-(\d+)/i);
    if (issueMatch && issueMatch[1]) {
      const issueRes = await issueView(repoRoot, { id: issueMatch[1] }).catch(() => undefined);
      if (issueRes && issueRes.ok) {
        issueContext = {
          id: issueRes.id,
          title: issueRes.title,
          type: issueRes.type,
          milestone: issueRes.milestone,
          parent: issueRes.parent ? { number: issueRes.parent.number, title: issueRes.parent.title } : undefined,
        };
      }
    }

    return {
      ok: true as const,
      pack: packSummary,
      issueContext,
    };
  }

  const indexPath = join(repoRoot, ".ai", "INDEX.md");
  const signaturesPath = join(repoRoot, "docs", "generated", "signatures", "signatures-map.md");

  let content = "";
  if (input.scope) {
    if (existsSync(signaturesPath)) {
      const sigs = await readFile(signaturesPath, "utf8");
      const sections = sigs.split("### ");
      const matched = sections.filter((s) => s.toLowerCase().includes(input.scope!.toLowerCase()));
      if (matched.length > 0) {
        content = matched.map((m) => "### " + m).join("\n").slice(0, 4000);
      }
    }
    if (!content && existsSync(indexPath)) {
      const index = await readFile(indexPath, "utf8");
      const lines = index.split("\n").filter((l) => l.toLowerCase().includes(input.scope!.toLowerCase()));
      content = lines.join("\n");
    }
  } else if (input.query) {
    const results: string[] = [];
    if (existsSync(indexPath)) {
      const index = await readFile(indexPath, "utf8");
      for (const line of index.split("\n")) {
        if (line.toLowerCase().includes(input.query.toLowerCase())) results.push(`[.ai/INDEX.md] ${line.trim()}`);
      }
    }
    if (existsSync(signaturesPath)) {
      const sigs = await readFile(signaturesPath, "utf8");
      for (const line of sigs.split("\n")) {
        if (line.toLowerCase().includes(input.query.toLowerCase())) {
          results.push(`[signatures-map.md] ${line.trim()}`);
          if (results.length >= 30) break;
        }
      }
    }
    content = results.slice(0, 30).join("\n");
  } else {
    if (existsSync(indexPath)) {
      content = await readFile(indexPath, "utf8");
    }
  }

  return {
    ok: true as const,
    summary: content || "No context found matching criteria.",
  };
}

