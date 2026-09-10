#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_REGISTRY,
  commandRoutes,
  findCommandByCliRoute,
  parameterFlag,
  routeLabel,
  type AnyCommand,
} from "./command-registry.ts";
import { parseCommandInput } from "./flag-input.ts";
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
  // An interactive terminal never reaches EOF on its own, so a command that
  // legitimately takes no arguments -- `task graph`, `task sweep`, `doc-check`
  // -- would sit there waiting for a JSON body nobody is going to type.
  if (process.stdin.isTTY) return {};
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

/** One line per command, rendered from the registry so it can never go stale. */
function usageText(): string {
  const lines = COMMAND_REGISTRY.map((cmd) => {
    const routes = commandRoutes(cmd).map(routeLabel).join(" | ");
    return `  ia-graft ${routes}${commandFlagSummary(cmd)}`;
  });
  return [
    "usage: ia-graft <command> [--flags]",
    "",
    ...lines,
    "  ia-graft mcp",
    "",
    "Add --help after any command for its full flag list.",
    "",
    "Any prose flag also accepts --<flag>-file <path>. Prefer it: ia-graft.cmd forwards argv with %*,",
    "and cmd.exe cuts an argument at its first newline, so a multi-line value passed inline is silently",
    "truncated. JSON on stdin, or --input <json|file.json>, works for every command.",
  ].join("\n");
}

function commandFlagSummary(cmd: AnyCommand): string {
  const parts = Object.entries(cmd.parameters)
    .filter(([, spec]) => spec.mcpOnly !== true)
    .map(([key, spec]) => {
      const flag = parameterFlag(key, spec);
      const token = spec.type === "boolean" ? flag : `${flag} <${key}>`;
      return spec.required && spec.default === undefined ? ` ${token}` : ` [${token}]`;
    });
  return parts.join("");
}

/** The full flag list for one command, for `ia-graft <command> --help`. */
function helpText(cmd: AnyCommand): string {
  const rows = Object.entries(cmd.parameters).map(([key, spec]) => {
    const flags = spec.mcpOnly
      ? `(${key}, MCP only)`
      : [parameterFlag(key, spec), ...(spec.flagAliases ?? [])].join(", ");
    const marks = [
      spec.required && spec.default === undefined ? "required" : undefined,
      spec.default !== undefined ? `default ${spec.default}` : undefined,
      spec.prose ? "accepts --<flag>-file" : undefined,
      spec.type === "array" ? "repeatable" : undefined,
      spec.positional ? "also positional" : undefined,
    ].filter(Boolean);
    return `  ${flags}${marks.length > 0 ? ` [${marks.join(", ")}]` : ""}\n      ${spec.description}`;
  });
  return [
    `ia-graft ${commandRoutes(cmd).map(routeLabel).join(" | ")}`,
    `MCP tool: ${cmd.name}`,
    "",
    cmd.description,
    ...(rows.length > 0 ? ["", ...rows] : []),
  ].join("\n");
}

function printAndExit(result: { ok: boolean; [key: string]: unknown }): never {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok && result.passed !== false ? 0 : 1);
}

/**
 * Splits argv into a command route and the arguments that follow it.
 *
 * The subcommand slot is only filled by an argument that is not a flag: the
 * router used to take argv[1] unconditionally, so every group without a
 * subcommand broke the moment a flag was passed -- `ia-graft context --map`
 * answered with the usage text although the usage text documents it (#260).
 * A group that has both a subcommand-less command and a positional argument
 * still resolves, because a failed two-part lookup falls back to one part.
 */
function resolveCommand(argv: string[]): { cmd: AnyCommand; args: string[] } | undefined {
  const group = argv[0];
  if (!group) return undefined;
  const candidate = argv[1];
  if (candidate !== undefined && !candidate.startsWith("-")) {
    const withSubcommand = findCommandByCliRoute(group, candidate);
    if (withSubcommand) return { cmd: withSubcommand, args: argv.slice(2) };
  }
  const bare = findCommandByCliRoute(group);
  return bare ? { cmd: bare, args: argv.slice(1) } : undefined;
}

async function main(argv: string[]): Promise<void> {
  const root = repoRoot();

  // Commands are intentionally runnable from inside a task worktree. Move the
  // process itself to the main checkout before a sweep can remove that
  // worktree; Windows refuses to remove a process's current working directory
  // and otherwise leaves a partially deleted, unregistered directory behind.
  process.chdir(root);

  try {
    if (argv[0] === "mcp") {
      await runMcpServer(root);
      return;
    }

    const resolved = resolveCommand(argv);
    if (!resolved) {
      printAndExit({ ok: false, error: usageText() });
    }

    const { cmd, args } = resolved;
    if (args.includes("--help") || args.includes("-h")) {
      process.stdout.write(`${helpText(cmd)}\n`);
      process.exit(0);
    }

    // Precedence: an explicit --input wins, then the flags actually typed,
    // and only a command invoked with no arguments at all waits on stdin --
    // which is why `guard-check --tool Bash --command X` no longer hangs
    // there instead of being parsed (#260).
    const explicit = readInputFlag(args);
    const input = explicit ?? (args.length > 0 ? parseCommandInput(cmd, args) : await readStdin());

    printAndExit((await cmd.handler(root, input)) as { ok: boolean });
  } catch (error) {
    printAndExit({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

await main(process.argv.slice(2));
