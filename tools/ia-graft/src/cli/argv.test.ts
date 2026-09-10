import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findCommandByCliRoute } from "../command-registry.ts";
import { parseCommandInput, readTextValue } from "./argv.ts";

const scratch = mkdtempSync(join(tmpdir(), "ia-graft-flag-input-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function fileWith(name: string, contents: string): string {
  const target = join(scratch, name);
  writeFileSync(target, contents, "utf8");
  return target;
}

/** Parses the arguments that follow a route, the way `bin.ts` hands them over. */
function parse(route: string, args: string[]): Record<string, unknown> {
  const [group, subcommand] = route.split(" ");
  const command = findCommandByCliRoute(group!, subcommand);
  assert.ok(command, `no command registered for route '${route}'`);
  return parseCommandInput(command, args);
}

/**
 * The bug this covers (#210): routing keyed on the subcommand alone let `task
 * new` answer for `issue new`, so `issue new --title "..."` received
 * `{ taskId, base, parent }` and every issue flag was silently dropped.
 */
test("issue new and task new are told apart by their group, not by sharing a name", () => {
  const issue = parse("issue new", ["--title", "Something", "--type", "bug"]);
  assert.equal(issue.title, "Something");
  assert.equal(issue.type, "bug");
  assert.equal("taskId" in issue, false);

  const task = parse("task new", ["--id", "TASK-1-X", "--base", "master"]);
  assert.equal(task.taskId, "TASK-1-X");
  assert.equal(task.base, "master");
  assert.equal("title" in task, false);
});

test("issue new defaults its type and carries the rest of its flags", () => {
  const issue = parse("issue new", [
    "--title", "T",
    "--area", "apps",
    "--priority", "P1-high",
    "--milestone", "M2",
    "--parent", "170",
  ]);
  assert.equal(issue.type, "task");
  assert.equal(issue.area, "apps");
  assert.equal(issue.priority, "P1-high");
  assert.equal(issue.milestone, "M2");
  assert.equal(issue.parent, 170);
});

test("a command invoked with no arguments parses to an empty input rather than another command's shape", () => {
  assert.deepEqual(parse("task graph", []), {});
  assert.deepEqual(parse("doc-check", []), {});
});

/**
 * The bug this covers (#260): `bin.ts` took argv[1] as the subcommand
 * unconditionally, so a group whose command has no subcommand was unroutable
 * the moment a flag followed it -- `ia-graft context --scope x` answered with
 * the usage text although the usage text documents it, and `guard-check` fell
 * through to stdin and blocked there instead of being parsed.
 */
test("a group whose command takes no subcommand still resolves when a flag follows", () => {
  assert.equal(findCommandByCliRoute("context")?.name, "graft_context");
  assert.equal(parse("context", ["--scope", "packages/ui"]).scope, "packages/ui");

  const guard = parse("guard-check", ["--agent", "claude", "--tool", "Bash", "--command", "ls"]);
  assert.deepEqual(guard, { agent: "claude", tool: "Bash", command: "ls" });
});

test("context is reachable as its own group and as a task subcommand, with one shape", () => {
  assert.equal(findCommandByCliRoute("task", "context")?.name, "graft_context");
  assert.deepEqual(parse("context", ["--query", "walls"]), parse("task context", ["--query", "walls"]));
  assert.equal(parse("context", ["--query", "walls"]).query, "walls");
});

test("context paths take a comma-separated list", () => {
  assert.deepEqual(parse("context", ["--paths", "apps/vtt, packages/ui"]).paths, ["apps/vtt", "packages/ui"]);
});

test("task test collects repeated --command flags into the list form", () => {
  assert.deepEqual(parse("task test", ["--id", "T", "--command", "a"]).commands, ["a"]);
  assert.deepEqual(parse("task test", ["--id", "T", "--command", "a", "--command", "b"]).commands, ["a", "b"]);
});

test("a flag alias reaches the same field as its primary spelling", () => {
  assert.equal(parse("task commit", ["--id", "T", "--message", "m", "--check"]).dryRun, true);
  assert.equal(parse("task deps", ["--id", "T", "--pkg", "left-pad"]).add, "left-pad");
  assert.equal(parse("task deps", ["--id", "T", "--filter", "packages/ui"]).workspace, "packages/ui");
  assert.equal(parse("pr view", ["--pr", "12"]).id, 12);
});

test("a number flag is coerced, and a non-number is refused rather than passed on as NaN", () => {
  assert.equal(parse("issue list", ["--limit", "5"]).limit, 5);
  assert.throws(() => parse("issue list", ["--limit", "many"]), /--limit expects a number/);
});

test("an id can be given positionally or by flag, and a flag value is never mistaken for one", () => {
  assert.equal(parse("issue view", ["260"]).id, 260);
  assert.equal(parse("issue view", ["--id", "260"]).id, 260);
  assert.equal(parse("issue tree", ["170"]).epic, 170);

  // `TASK-1-X` is --task's value, not a positional PR number.
  const byTask = parse("pr view", ["--task", "TASK-1-X"]);
  assert.equal(byTask.task, "TASK-1-X");
  assert.equal("id" in byTask, false);
});

test("a boolean defaulting to on can be turned off with its --no- spelling", () => {
  assert.equal(parse("delegate edit", ["--id", "T", "--prompt", "p"]).groundInRepoContext, true);
  assert.equal(
    parse("delegate edit", ["--id", "T", "--prompt", "p", "--no-ground-in-repo-context"]).groundInRepoContext,
    false,
  );
});

test("a misspelled flag is refused instead of silently dropping the value behind it", () => {
  assert.throws(() => parse("issue new", ["--titel", "T"]), /unknown flag --titel/);
});

test("a flag missing its value is refused instead of swallowing the next flag", () => {
  assert.throws(() => parse("issue new", ["--title", "--type", "bug"]), /--title requires a value/);
});

/**
 * The bug these cover (#212): `ia-graft.cmd` forwards argv with `%*` and
 * `cmd.exe` ends a command at a literal newline, so every multi-line value
 * was cut at its first line without a word of complaint. Prose travels by
 * file now.
 */
test("a multi-line commit message survives, because it never touches the command line", () => {
  const path = fileWith("message.txt", "feat(x): headline\n\nA body that explains why.\nSecond line of it.\n");
  const parsed = parse("task commit", ["--id", "T", "--message-file", path]);
  assert.equal(parsed.message, "feat(x): headline\n\nA body that explains why.\nSecond line of it.");
});

test("every prose flag takes the file form", () => {
  const done = parse("task done", [
    "--id", "T",
    "--title-file", fileWith("title.txt", "a title\n"),
    "--body-file", fileWith("body.md", "line one\nline two\n"),
  ]);
  assert.equal(done.title, "a title");
  assert.equal(done.body, "line one\nline two");

  const edit = parse("delegate edit", [
    "--id", "T",
    "--prompt-file", fileWith("prompt.txt", "do\nthis\n"),
    "--context-file", fileWith("context.txt", "given\nthat\n"),
  ]);
  assert.equal(edit.prompt, "do\nthis");
  assert.equal(edit.context, "given\nthat");
});

test("the inline form still works for a value that fits on one line", () => {
  assert.equal(parse("task commit", ["--id", "T", "--message", "fix: one-liner"]).message, "fix: one-liner");
});

test("giving both forms is refused rather than letting one silently win", () => {
  const path = fileWith("both.txt", "from the file");
  assert.throws(
    () => parse("task commit", ["--id", "T", "--message", "inline", "--message-file", path]),
    /--message and --message-file cannot both be given/,
  );
});

test("an unreadable file names itself instead of failing as a missing value", () => {
  assert.throws(
    () => parse("task commit", ["--id", "T", "--message-file", join(scratch, "absent.txt")]),
    /--message-file could not be read/,
  );
});

test("a BOM is stripped, so a PowerShell-written subject line is not invisibly corrupted", () => {
  const path = fileWith("bom.txt", "﻿fix: subject\n\nbody\n");
  assert.equal(readTextValue(["--message-file", path], "--message"), "fix: subject\n\nbody");
});
