#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { delegateRun } from "./delegate-commands.ts";
import { delegateEdit } from "./delegate-edit-commands.ts";
import { delegateResearch } from "./delegate-research-commands.ts";
import { runDocCheck } from "./doc-check.ts";
import { flagInput } from "./flag-input.ts";
import { runGuardCheck } from "./guard-command.ts";
import { issueList, issueNew, issueUpdate, issueView } from "./issue-commands.ts";
import { runMcpServer } from "./mcp-server.ts";
import { taskCheckout, taskCleanup, taskCommit, taskContext, taskDependencies, taskDoctor, taskDone, taskGraph, taskNew, taskResume, taskStatus, taskSweep, taskSync, taskTest } from "./task-commands.ts";

/**
 * Resolves the MAIN repository root, never a task worktree's own root, even
 * when this exact script is invoked from inside a task worktree (every
 * worktree has its own full copy of this file, and running it from there is
 * the natural thing an agent already `cd`ed into its task worktree would
 * do). `--git-common-dir` is the one thing every worktree and the main
 * checkout share -- unlike `--show-toplevel`, which a worktree reports as
 * itself. Falls back to script-relative resolution if git is unavailable.
 */
function repoRoot(): string {
  const scriptDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: scriptDir,
      encoding: "utf8",
    }).trim();
    return resolve(scriptDir, commonDir, "..");
  } catch {
    return resolve(scriptDir, "../../..");
  }
}

async function readStdin(): Promise<unknown> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  if (input.trim().length === 0) return {};
  return JSON.parse(input);
}

/**
 * `--input '<json>'` is available when the caller can preserve JSON quoting.
 * JSON stdin is the portable form for PowerShell and other shells that may
 * strip quotes from a JSON value passed through an argument variable.
 */
function readInputFlag(argv: string[]): unknown | undefined {
  const index = argv.indexOf("--input");
  if (index === -1) return undefined;
  const raw = argv[index + 1];
  if (raw === undefined) throw new Error("--input requires a JSON string argument");
  return JSON.parse(raw);
}

function printAndExit(result: { ok: boolean;[key: string]: unknown }): never {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok && result.passed !== false ? 0 : 1);
}

async function main(argv: string[]): Promise<void> {
  const [group, subcommand] = argv;
  const root = repoRoot();

  // Commands are intentionally runnable from inside a task worktree. Move the
  // process itself to the main checkout before a sweep can remove that
  // worktree; Windows refuses to remove a process's current working directory
  // and otherwise leaves a partially deleted, unregistered directory behind.
  process.chdir(root);

  try {
    if (group === "mcp") {
      await runMcpServer(root);
      return;
    }

    if (group === "guard-check") {
      const input = (readInputFlag(argv) ?? (await readStdin())) as Parameters<typeof runGuardCheck>[1];
      printAndExit(await runGuardCheck(root, input));
    }

    if (group === "doc-check") {
      printAndExit(await runDocCheck(root));
    }

    if (group === "context") {
      const input = readInputFlag(argv) ?? flagInput("context", undefined, argv) ?? (await readStdin());
      printAndExit(await taskContext(root, input as Parameters<typeof taskContext>[1]));
    }

    if (group === "issue") {
      const input = readInputFlag(argv) ?? flagInput(group, subcommand, argv) ?? (await readStdin());
      if (subcommand === "list") printAndExit(await issueList(root, input as Parameters<typeof issueList>[1]));
      if (subcommand === "view") printAndExit(await issueView(root, input as Parameters<typeof issueView>[1]));
      if (subcommand === "new") printAndExit(await issueNew(root, input as Parameters<typeof issueNew>[1]));
      if (subcommand === "update") printAndExit(await issueUpdate(root, input as Parameters<typeof issueUpdate>[1]));
    }

    if (group === "delegate") {
      const input = readInputFlag(argv) ?? flagInput(group, subcommand, argv) ?? (await readStdin());
      if (subcommand === "run") printAndExit(await delegateRun(root, input as Parameters<typeof delegateRun>[1]));
      if (subcommand === "edit") printAndExit(await delegateEdit(root, input as Parameters<typeof delegateEdit>[1]));
      if (subcommand === "research") printAndExit(await delegateResearch(root, input as Parameters<typeof delegateResearch>[1]));
    }

    if (group === "task") {
      const input = readInputFlag(argv) ?? flagInput(group, subcommand, argv) ?? (await readStdin());
      if (subcommand === "new") printAndExit(await taskNew(root, input as Parameters<typeof taskNew>[1]));
      if (subcommand === "resume") printAndExit(await taskResume(root, input as Parameters<typeof taskResume>[1]));
      if (subcommand === "commit") printAndExit(await taskCommit(root, input as Parameters<typeof taskCommit>[1]));
      if (subcommand === "test") printAndExit(await taskTest(root, input as Parameters<typeof taskTest>[1]));
      if (subcommand === "sync") printAndExit(await taskSync(root, input as Parameters<typeof taskSync>[1]));
      if (subcommand === "deps") printAndExit(await taskDependencies(root, input as Parameters<typeof taskDependencies>[1]));
      if (subcommand === "done") printAndExit(await taskDone(root, input as Parameters<typeof taskDone>[1]));
      if (subcommand === "cleanup") printAndExit(await taskCleanup(root, input as Parameters<typeof taskCleanup>[1]));
      if (subcommand === "status") printAndExit(await taskStatus(root, input as Parameters<typeof taskStatus>[1]));
      if (subcommand === "doctor") printAndExit(await taskDoctor(root, input as Parameters<typeof taskDoctor>[1]));
      if (subcommand === "checkout") printAndExit(await taskCheckout(root, input as Parameters<typeof taskCheckout>[1]));
      if (subcommand === "graph") printAndExit(await taskGraph(root));
      if (subcommand === "sweep") printAndExit(await taskSweep(root));
      if (subcommand === "context") printAndExit(await taskContext(root, input as Parameters<typeof taskContext>[1]));
    }

    printAndExit({
      ok: false,
      error: `usage: ia-graft guard-check | ia-graft context [--query <q> | --scope <s> | --map] | ia-graft issue <list|view|new|update> | ia-graft task <new|resume|sync|deps|commit|test|done|cleanup|status|doctor|checkout|graph|sweep|context> | ia-graft delegate run --prompt <p> [--effort low|medium|high] [--file <path>]... [--json-schema <json>] | ia-graft delegate edit --id <TASK-ID> --prompt <p> [--effort low|medium|high] [--scope <prefix>]... [--context <text>] | ia-graft delegate research --id <TASK-ID> --topic <t> --output-file <path.md> [--effort low|medium|high]`,
    });
  } catch (error) {
    printAndExit({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await main(process.argv.slice(2));
