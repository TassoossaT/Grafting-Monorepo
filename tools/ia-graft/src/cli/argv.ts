/**
 * Turns `--flag value` argv into the input record a command expects, reading
 * the command's own parameter declarations to do it.
 *
 * This file used to carry a second, hand-written copy of every command's
 * shape -- one `if (route === "issue new") return { ... }` branch per command
 * -- which could and did disagree with both the handler interface and the MCP
 * schema (#260). Nothing here knows any command by name any more: the flags,
 * their aliases, which values are prose, which are lists and which are
 * numbers all come from `command-registry.ts`, so a command's CLI surface and
 * its MCP surface cannot describe different things.
 *
 * Its own module rather than a piece of `bin.ts`, so a test can exercise the
 * parsing without importing an entry point that runs `main()` and exits on
 * import.
 */

import { readFileSync } from "node:fs";
import { parameterFlags, type AnyCommand, type ParameterSpec } from "../command-registry.ts";

const asList = (names: string | string[]): string[] => (typeof names === "string" ? [names] : names);

export function readValue(argv: string[], names: string | string[]): string | undefined {
  for (const name of asList(names)) {
    const index = argv.indexOf(name);
    if (index === -1) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  }
  return undefined;
}

/**
 * A value carrying prose, which must not be trusted to the command line.
 *
 * `ia-graft.cmd` forwards its arguments with `%*`, and `cmd.exe` ends a
 * command at a literal newline -- so `--message "line one\nline two"` reached
 * the CLI as `"line one"`, silently, with no error. Every commit body, PR
 * description, and delegate prompt written through the invocation `AGENTS.md`
 * mandates lost everything after its first line, and nothing reported it.
 *
 * `%*` cannot be made newline-safe: the command is already over by the time
 * the wrapper runs. So prose travels by file instead -- `--message-file
 * <path>` beside `--message`, for every flag that can hold more than a
 * phrase. The two forms are mutually exclusive rather than one silently
 * winning, because a caller passing both has a wrong belief about which is
 * being used.
 *
 * A BOM is stripped (PowerShell writes UTF-8 with one by default, and a BOM
 * at the head of a commit subject is invisible until it is not), and trailing
 * whitespace goes with it -- a file ends in a newline that no caller of this
 * meant as content.
 */
export function readTextValue(argv: string[], names: string | string[]): string | undefined {
  const flags = asList(names);
  const filePath = readValue(argv, flags.map((flag) => `${flag}-file`));
  const inline = readValue(argv, flags);
  const primary = flags[0];
  if (filePath !== undefined && inline !== undefined) {
    throw new Error(`${primary} and ${primary}-file cannot both be given`);
  }
  if (filePath === undefined) return inline;
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `${primary}-file could not be read (${filePath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return contents.replace(/^﻿/, "").trimEnd();
}

export function readValues(argv: string[], names: string | string[]): string[] {
  const flags = new Set(asList(names));
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined || !flags.has(argument)) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    values.push(value);
  }
  return values;
}

/** The `--no-` spelling that turns a boolean flag off, for a parameter that defaults to on. */
const negated = (flag: string): string => flag.replace(/^--/, "--no-");

function coerce(spec: ParameterSpec, flag: string, raw: string): unknown {
  if (spec.json) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`${flag} expects JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (spec.type !== "number") return raw;
  const value = Number(raw);
  if (Number.isNaN(value)) throw new Error(`${flag} expects a number, got ${raw}`);
  return value;
}

/** Every flag spelling a command answers to, and which of them take a value. */
function knownFlags(command: AnyCommand): { all: Set<string>; withValue: Set<string> } {
  const all = new Set<string>();
  const withValue = new Set<string>();
  for (const [key, spec] of Object.entries(command.parameters)) {
    if (spec.mcpOnly) continue;
    for (const flag of parameterFlags(key, spec)) {
      all.add(flag);
      if (spec.type === "boolean") {
        all.add(negated(flag));
        continue;
      }
      withValue.add(flag);
      if (spec.prose) {
        all.add(`${flag}-file`);
        withValue.add(`${flag}-file`);
      }
    }
  }
  return { all, withValue };
}

/**
 * Builds one command's input record from the arguments that follow its route.
 *
 * `args` excludes the group and subcommand, so a positional value can be
 * found by walking the arguments and stepping over each flag together with
 * the value it consumes -- `pr view --task TASK-1-X` has no positional, and
 * only `issue view 260` does. An argument that looks like a flag but belongs
 * to no parameter is refused rather than ignored, so a typo cannot silently
 * drop the value the caller meant to pass.
 */
export function parseCommandInput(command: AnyCommand, args: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const flags = knownFlags(command);
  let positional: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("-")) {
      positional ??= argument;
      continue;
    }
    if (!flags.all.has(argument)) {
      throw new Error(`unknown flag ${argument}; accepted: ${[...flags.all].sort().join(" ")}`);
    }
    if (flags.withValue.has(argument)) index += 1;
  }

  for (const [key, spec] of Object.entries(command.parameters)) {
    // Some parameters exist only as an MCP affordance and have no flag at
    // all -- `task test` takes one `command` or many `commands`, and over the
    // command line a repeated `--command` is always the list form.
    if (spec.mcpOnly) continue;
    const spellings = parameterFlags(key, spec);
    const primary = spellings[0] ?? `--${key}`;

    if (spec.type === "boolean") {
      if (spellings.some((flag) => args.includes(negated(flag)))) input[key] = false;
      else if (spellings.some((flag) => args.includes(flag))) input[key] = true;
      else if (spec.default !== undefined) input[key] = spec.default;
      continue;
    }

    if (spec.type === "array") {
      let values = readValues(args, spellings);
      if (spec.csv) {
        values = values.flatMap((value) =>
          value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        );
      }
      if (values.length > 0) input[key] = values;
      continue;
    }

    const inline = spec.prose ? readTextValue(args, spellings) : readValue(args, spellings);
    const raw = inline ?? (spec.positional ? positional : undefined);
    if (raw === undefined) {
      if (spec.default !== undefined) input[key] = spec.default;
      continue;
    }
    input[key] = coerce(spec, primary, raw);
  }

  return input;
}
