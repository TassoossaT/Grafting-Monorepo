/**
 * Turning `--flag value` argv into the input record each command expects.
 *
 * Its own module rather than a piece of `bin.ts`, so a test can exercise the
 * routing without importing an entry point that runs `main()` and exits on
 * import.
 */

import { readFileSync } from "node:fs";

export function readValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
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
export function readTextValue(argv: string[], name: string): string | undefined {
  const filePath = readValue(argv, `${name}-file`);
  const inline = readValue(argv, name);
  if (filePath !== undefined && inline !== undefined) {
    throw new Error(`${name} and ${name}-file cannot both be given`);
  }
  if (filePath === undefined) return inline;
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`${name}-file could not be read (${filePath}): ${error instanceof Error ? error.message : String(error)}`);
  }
  return contents.replace(/^﻿/, "").trimEnd();
}

export function readValues(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    values.push(value);
  }
  return values;
}

/**
 * Parses `--flag value` arguments into the input record one command expects.
 *
 * Keyed on the **group and the subcommand together**, never the subcommand
 * alone: `new` belongs to both `task` and `issue`, and matching it by name
 * meant `task new`'s branch answered for `issue new` too, handing it
 * `{ taskId, base, parent }` and dropping every flag the caller passed --
 * so `issue new --title "..."` could only ever fail with "missing issue
 * title" (#210). The route is the whole identity of a command; anything
 * less is a collision waiting for the next subcommand to share a name.
 */
export function flagInput(
  group: string | undefined,
  subcommand: string | undefined,
  argv: string[],
): unknown | undefined {
  if (!argv.some((arg) => arg.startsWith("--") && arg !== "--force")) return undefined;
  const route = subcommand === undefined ? group : `${group} ${subcommand}`;
  const taskId = readValue(argv, "--id");
  if (route === "task new") return { taskId, base: readValue(argv, "--base"), parent: readValue(argv, "--parent") };
  if (route === "task resume") {
    const pr = readValue(argv, "--pr");
    return { taskId, pr: pr === undefined ? undefined : Number(pr) };
  }
  if (route === "task commit") {
    return {
      taskId,
      message: readTextValue(argv, "--message"),
      files: readValues(argv, "--file"),
      coAuthors: readValues(argv, "--co-author"),
      agent: readValue(argv, "--agent"),
      amend: argv.includes("--amend"),
      dryRun: argv.includes("--dry-run") || argv.includes("--check"),
    };
  }
  if (route === "task test") {
    const commands = readValues(argv, "--command");
    return commands.length <= 1
      ? { taskId, command: commands[0], keepGoing: argv.includes("--keep-going") }
      : { taskId, commands, keepGoing: argv.includes("--keep-going") };
  }
  if (route === "task deps") {
    return {
      taskId,
      install: argv.includes("--install"),
      updateLockfile: argv.includes("--update-lockfile") || argv.includes("--update"),
      add: readValue(argv, "--add") ?? readValue(argv, "--pkg"),
      workspace: readValue(argv, "--workspace") ?? readValue(argv, "--filter"),
      dev: argv.includes("--dev") || argv.includes("-D"),
    };
  }
  if (route === "task done") {
    return {
      taskId,
      title: readTextValue(argv, "--title"),
      body: readTextValue(argv, "--body"),
      base: readValue(argv, "--base"),
    };
  }
  if (route === "task cleanup") return { taskId, force: argv.includes("--force") };
  if (route === "task sync") return { taskId, fetch: argv.includes("--fetch"), abort: argv.includes("--abort") };
  if (route === "task status") return { taskId };
  if (route === "task doctor") return { taskId };
  if (route === "task checkout") return { taskId, restore: argv.includes("--restore"), force: argv.includes("--force") };
  if (route === "context" || route === "task context") {
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
  if (route === "delegate run") {
    const jsonSchemaRaw = readValue(argv, "--json-schema");
    const files = readValues(argv, "--file");
    return {
      prompt: readTextValue(argv, "--prompt"),
      effort: readValue(argv, "--effort"),
      files: files.length > 0 ? files : undefined,
      jsonSchema: jsonSchemaRaw === undefined ? undefined : JSON.parse(jsonSchemaRaw),
    };
  }
  if (route === "delegate edit") {
    const scope = readValues(argv, "--scope");
    return {
      taskId,
      prompt: readTextValue(argv, "--prompt"),
      effort: readValue(argv, "--effort"),
      scope: scope.length > 0 ? scope : undefined,
      context: readTextValue(argv, "--context"),
    };
  }
  if (route === "delegate research") {
    return { taskId, topic: readTextValue(argv, "--topic"), outputFile: readValue(argv, "--output-file"), effort: readValue(argv, "--effort") };
  }
  if (route === "issue list") {
    const rawLimit = readValue(argv, "--limit");
    return {
      type: readValue(argv, "--type"),
      area: readValue(argv, "--area"),
      status: readValue(argv, "--status"),
      priority: readValue(argv, "--priority"),
      limit: rawLimit ? Number(rawLimit) : undefined,
    };
  }
  if (route === "issue view") {
    return { id: readValue(argv, "--id") ?? argv[2] };
  }
  if (route === "issue new") {
    return {
      title: readTextValue(argv, "--title"),
      type: readValue(argv, "--type") || "task",
      area: readValue(argv, "--area"),
      priority: readValue(argv, "--priority"),
      status: readValue(argv, "--status"),
      milestone: readValue(argv, "--milestone"),
      parent: readValue(argv, "--parent"),
      body: readTextValue(argv, "--body"),
    };
  }
  if (route === "issue update") {
    return {
      id: readValue(argv, "--id") ?? argv[2],
      status: readValue(argv, "--status"),
      priority: readValue(argv, "--priority"),
      comment: readTextValue(argv, "--comment"),
    };
  }
  return undefined;
}
