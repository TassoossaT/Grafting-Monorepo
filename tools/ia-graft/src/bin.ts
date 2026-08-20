#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { delegateRun } from "./delegate-commands.ts";
import { delegateEdit } from "./delegate-edit-commands.ts";
import { delegateResearch } from "./delegate-research-commands.ts";
import { runDocCheck } from "./doc-check.ts";
import { runGuardCheck } from "./guard-command.ts";
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

function readValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function readValues(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    values.push(value);
  }
  return values;
}

function flagInput(subcommand: string | undefined, argv: string[]): unknown | undefined {
  if (!argv.some((arg) => arg.startsWith("--") && arg !== "--force")) return undefined;
  const taskId = readValue(argv, "--id");
  if (subcommand === "new") return { taskId, base: readValue(argv, "--base"), parent: readValue(argv, "--parent") };
  if (subcommand === "resume") {
    const pr = readValue(argv, "--pr");
    return { taskId, pr: pr === undefined ? undefined : Number(pr) };
  }
  if (subcommand === "commit") {
    return {
      taskId,
      message: readValue(argv, "--message"),
      files: readValues(argv, "--file"),
      coAuthors: readValues(argv, "--co-author"),
      agent: readValue(argv, "--agent"),
      amend: argv.includes("--amend"),
      dryRun: argv.includes("--dry-run") || argv.includes("--check"),
    };
  }
  if (subcommand === "test") {
    const commands = readValues(argv, "--command");
    return commands.length <= 1
      ? { taskId, command: commands[0], keepGoing: argv.includes("--keep-going") }
      : { taskId, commands, keepGoing: argv.includes("--keep-going") };
  }
  if (subcommand === "deps") {
    return {
      taskId,
      install: argv.includes("--install"),
      updateLockfile: argv.includes("--update-lockfile") || argv.includes("--update"),
      add: readValue(argv, "--add") ?? readValue(argv, "--pkg"),
      workspace: readValue(argv, "--workspace") ?? readValue(argv, "--filter"),
      dev: argv.includes("--dev") || argv.includes("-D"),
    };
  }
  if (subcommand === "done") {
    return {
      taskId,
      title: readValue(argv, "--title"),
      body: readValue(argv, "--body"),
      base: readValue(argv, "--base"),
    };
  }
  if (subcommand === "cleanup") return { taskId, force: argv.includes("--force") };
  if (subcommand === "sync") return { taskId, fetch: argv.includes("--fetch"), abort: argv.includes("--abort") };
  if (subcommand === "status") return { taskId };
  if (subcommand === "doctor") return { taskId };
  if (subcommand === "checkout") return { taskId, restore: argv.includes("--restore"), force: argv.includes("--force") };
  if (subcommand === "context") {
    const rawPaths = readValue(argv, "--paths");
    return {
      query: readValue(argv, "--query"),
      scope: readValue(argv, "--scope"),
      map: argv.includes("--map"),
      pack: argv.includes("--pack"),
      taskId: readValue(argv, "--id") ?? readValue(argv, "--task"),
      paths: rawPaths ? rawPaths.split(",").map((p) => p.trim()).filter(Boolean) : undefined,
    };
  }
  if (subcommand === "run") {
    const jsonSchemaRaw = readValue(argv, "--json-schema");
    const files = readValues(argv, "--file");
    return {
      prompt: readValue(argv, "--prompt"),
      effort: readValue(argv, "--effort"),
      files: files.length > 0 ? files : undefined,
      jsonSchema: jsonSchemaRaw === undefined ? undefined : JSON.parse(jsonSchemaRaw),
    };
  }
  if (subcommand === "edit") {
    const scope = readValues(argv, "--scope");
    return {
      taskId,
      prompt: readValue(argv, "--prompt"),
      effort: readValue(argv, "--effort"),
      scope: scope.length > 0 ? scope : undefined,
      context: readValue(argv, "--context"),
    };
  }
  if (subcommand === "research") {
    return { taskId, topic: readValue(argv, "--topic"), outputFile: readValue(argv, "--output-file"), effort: readValue(argv, "--effort") };
  }
  return undefined;
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
      const input = readInputFlag(argv) ?? flagInput("context", argv) ?? (await readStdin());
      printAndExit(await taskContext(root, input as Parameters<typeof taskContext>[1]));
    }


    if (group === "delegate") {
      const input = readInputFlag(argv) ?? flagInput(subcommand, argv) ?? (await readStdin());
      if (subcommand === "run") printAndExit(await delegateRun(root, input as Parameters<typeof delegateRun>[1]));
      if (subcommand === "edit") printAndExit(await delegateEdit(root, input as Parameters<typeof delegateEdit>[1]));
      if (subcommand === "research") printAndExit(await delegateResearch(root, input as Parameters<typeof delegateResearch>[1]));
    }

    if (group === "task") {
      const input = readInputFlag(argv) ?? flagInput(subcommand, argv) ?? (await readStdin());
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
      error: `usage: ia-graft guard-check | ia-graft context [--query <q> | --scope <s> | --map] | ia-graft task <new|resume|sync|deps|commit|test|done|cleanup|status|doctor|checkout|graph|sweep|context> | ia-graft delegate run --prompt <p> [--effort low|medium|high] [--file <path>]... [--json-schema <json>] | ia-graft delegate edit --id <TASK-ID> --prompt <p> [--effort low|medium|high] [--scope <prefix>]... [--context <text>] | ia-graft delegate research --id <TASK-ID> --topic <t> --output-file <path.md> [--effort low|medium|high]`,
    });
  } catch (error) {
    printAndExit({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await main(process.argv.slice(2));
