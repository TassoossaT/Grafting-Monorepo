#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuardCheck } from "./guard-command.ts";
import { taskCleanup, taskCommit, taskDone, taskNew } from "./task-commands.ts";

function repoRoot(): string {
  // tools/ia-graft/src/bin.ts -> repo root is three levels up.
  return resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
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
      if (subcommand === "done") printAndExit(await taskDone(root, input as Parameters<typeof taskDone>[1]));
      if (subcommand === "cleanup") printAndExit(await taskCleanup(root, input as Parameters<typeof taskCleanup>[1]));
    }

    printAndExit({
      ok: false,
      error: `usage: ia-graft guard-check | ia-graft task <new|commit|done|cleanup>  (JSON input on stdin)`,
    });
  } catch (error) {
    printAndExit({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await main(process.argv.slice(2));
