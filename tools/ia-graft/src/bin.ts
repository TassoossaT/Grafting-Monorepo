#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuardCheck } from "./guard-command.ts";
import { taskCleanup, taskCommit, taskDone, taskNew, taskSweep, taskTest } from "./task-commands.ts";

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
 * `--input '<json>'` is the single-invocation-safe form (no pipe needed).
 * Stdin remains supported for interactive/scripted use.
 */
function readInputFlag(argv: string[]): unknown | undefined {
  const index = argv.indexOf("--input");
  if (index === -1) return undefined;
  const raw = argv[index + 1];
  if (raw === undefined) throw new Error("--input requires a JSON string argument");
  return JSON.parse(raw);
}

function printAndExit(result: { ok: boolean; [key: string]: unknown }): never {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}

async function main(argv: string[]): Promise<void> {
  const [group, subcommand] = argv;
  const root = repoRoot();

  try {
    if (group === "guard-check") {
      const input = (readInputFlag(argv) ?? (await readStdin())) as Parameters<typeof runGuardCheck>[1];
      printAndExit(await runGuardCheck(root, input));
    }

    if (group === "task") {
      const input = readInputFlag(argv) ?? (await readStdin());
      if (subcommand === "new") printAndExit(await taskNew(root, input as Parameters<typeof taskNew>[1]));
      if (subcommand === "commit") printAndExit(await taskCommit(root, input as Parameters<typeof taskCommit>[1]));
      if (subcommand === "test") printAndExit(await taskTest(root, input as Parameters<typeof taskTest>[1]));
      if (subcommand === "done") printAndExit(await taskDone(root, input as Parameters<typeof taskDone>[1]));
      if (subcommand === "cleanup") printAndExit(await taskCleanup(root, input as Parameters<typeof taskCleanup>[1]));
      if (subcommand === "sweep") printAndExit(await taskSweep(root));
    }

    printAndExit({
      ok: false,
      error: `usage: ia-graft guard-check | ia-graft task <new|commit|test|done|cleanup|sweep>  (JSON input on stdin)`,
    });
  } catch (error) {
    printAndExit({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await main(process.argv.slice(2));
