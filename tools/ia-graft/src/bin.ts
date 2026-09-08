#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findCommandByCliRoute } from "./command-registry.ts";
import { flagInput } from "./flag-input.ts";
import { runMcpServer } from "./mcp-server.ts";

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
 * Also supports `--input <file.json>` path directly.
 */
function readInputFlag(argv: string[]): unknown | undefined {
  const index = argv.indexOf("--input");
  if (index === -1) return undefined;
  const raw = argv[index + 1];
  if (raw === undefined) throw new Error("--input requires a JSON string argument");
  if (existsSync(raw)) {
    return JSON.parse(readFileSync(raw, "utf8"));
  }
  return JSON.parse(raw);
}

function printAndExit(result: { ok: boolean; [key: string]: unknown }): never {
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

    const cmd = group ? findCommandByCliRoute(group, subcommand) : undefined;
    if (cmd) {
      const input = readInputFlag(argv) ?? flagInput(group, subcommand, argv) ?? (await readStdin());
      printAndExit(await cmd.handler(root, input));
    }

    printAndExit({
      ok: false,
      error: `usage: ia-graft guard-check | ia-graft context [--query <q> | --scope <s> | --map] | ia-graft issue <list|view|new|update|close|reopen|tree|doctor> | ia-graft pr <list|view|checks|diff> | ia-graft task <new|resume|sync|deps|commit|test|done|cleanup|status|doctor|checkout|graph|sweep|context> | ia-graft delegate run --prompt <p> [--effort low|medium|high] [--file <path>]... [--json-schema <json>] | ia-graft delegate edit --id <TASK-ID> --prompt <p> [--effort low|medium|high] [--scope <prefix>]... [--context <text>] | ia-graft delegate research --id <TASK-ID> --topic <t> --output-file <path.md> [--effort low|medium|high]

Any prose flag (--message, --title, --body, --prompt, --context, --topic, --comment) also accepts --<flag>-file <path>. Prefer it: ia-graft.cmd forwards argv with %*, and cmd.exe cuts an argument at its first newline, so a multi-line value passed inline is silently truncated. JSON on stdin, or --input <json>, works for every command.`,
    });
  } catch (error) {
    printAndExit({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await main(process.argv.slice(2));
