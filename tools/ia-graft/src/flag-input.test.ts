import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { flagInput, readTextValue } from "./flag-input.ts";

const scratch = mkdtempSync(join(tmpdir(), "ia-graft-flag-input-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function fileWith(name: string, contents: string): string {
  const target = join(scratch, name);
  writeFileSync(target, contents, "utf8");
  return target;
}

/**
 * The bug these tests exist for (#210): routing keyed on the subcommand
 * alone let `task new` answer for `issue new`, so `issue new --title "..."`
 * received `{ taskId, base, parent }` and every issue flag was silently
 * dropped. It could only ever fail with "missing issue title".
 */
test("issue new and task new are told apart by their group, not by sharing a name", () => {
  const issue = flagInput("issue", "new", ["issue", "new", "--title", "Something", "--type", "bug"]) as Record<string, unknown>;
  assert.equal(issue.title, "Something");
  assert.equal(issue.type, "bug");
  assert.equal("taskId" in issue, false);

  const task = flagInput("task", "new", ["task", "new", "--id", "TASK-1-X", "--base", "master"]) as Record<string, unknown>;
  assert.equal(task.taskId, "TASK-1-X");
  assert.equal(task.base, "master");
  assert.equal("title" in task, false);
});

test("issue new defaults its type and carries the rest of its flags", () => {
  const issue = flagInput("issue", "new", [
    "issue", "new",
    "--title", "T",
    "--area", "apps",
    "--priority", "P1-high",
    "--body", "B",
  ]) as Record<string, unknown>;
  assert.deepEqual(issue, {
    title: "T",
    type: "task",
    area: "apps",
    priority: "P1-high",
    status: undefined,
    milestone: undefined,
    parent: undefined,
    body: "B",
  });
});

test("a group with no flags at all falls through, leaving stdin as the input", () => {
  assert.equal(flagInput("issue", "new", ["issue", "new"]), undefined);
  assert.equal(flagInput("task", "status", ["task", "status"]), undefined);
});

test("an unroutable group/subcommand pair returns nothing rather than another command's shape", () => {
  assert.equal(flagInput("issue", "commit", ["issue", "commit", "--message", "m"]), undefined);
  assert.equal(flagInput("task", "list", ["task", "list", "--limit", "5"]), undefined);
  assert.equal(flagInput(undefined, undefined, ["--id", "TASK-1-X"]), undefined);
});

test("context is reachable as its own group and as a task subcommand, with one shape", () => {
  const asGroup = flagInput("context", undefined, ["context", "--query", "walls"]);
  const asTask = flagInput("task", "context", ["task", "context", "--query", "walls"]);
  assert.deepEqual(asGroup, asTask);
  assert.equal((asGroup as Record<string, unknown>).query, "walls");
});

test("task test collects repeated --command flags, and a single one keeps the scalar shape", () => {
  const one = flagInput("task", "test", ["task", "test", "--id", "T", "--command", "a"]) as Record<string, unknown>;
  assert.equal(one.command, "a");
  assert.equal("commands" in one, false);

  const many = flagInput("task", "test", ["task", "test", "--id", "T", "--command", "a", "--command", "b"]) as Record<string, unknown>;
  assert.deepEqual(many.commands, ["a", "b"]);
});

test("a flag missing its value is refused instead of swallowing the next flag", () => {
  assert.throws(() => flagInput("issue", "new", ["issue", "new", "--title", "--type", "bug"]), /--title requires a value/);
});

/**
 * The bug these cover (#212): `ia-graft.cmd` forwards argv with `%*` and
 * `cmd.exe` ends a command at a literal newline, so every multi-line value
 * was cut at its first line without a word of complaint. Prose travels by
 * file now.
 */
test("a multi-line commit message survives, because it never touches the command line", () => {
  const message = "feat(x): headline\n\nA body that explains why.\nSecond line of it.\n";
  const path = fileWith("message.txt", message);
  const parsed = flagInput("task", "commit", ["task", "commit", "--id", "T", "--message-file", path]) as Record<string, unknown>;
  assert.equal(parsed.message, "feat(x): headline\n\nA body that explains why.\nSecond line of it.");
});

test("every prose flag takes the file form", () => {
  const done = flagInput("task", "done", [
    "task", "done", "--id", "T",
    "--title-file", fileWith("title.txt", "a title\n"),
    "--body-file", fileWith("body.md", "line one\nline two\n"),
  ]) as Record<string, unknown>;
  assert.equal(done.title, "a title");
  assert.equal(done.body, "line one\nline two");

  const edit = flagInput("delegate", "edit", [
    "delegate", "edit", "--id", "T",
    "--prompt-file", fileWith("prompt.txt", "do\nthis\n"),
    "--context-file", fileWith("context.txt", "given\nthat\n"),
  ]) as Record<string, unknown>;
  assert.equal(edit.prompt, "do\nthis");
  assert.equal(edit.context, "given\nthat");
});

test("the inline form still works for a value that fits on one line", () => {
  const parsed = flagInput("task", "commit", ["task", "commit", "--id", "T", "--message", "fix: one-liner"]) as Record<string, unknown>;
  assert.equal(parsed.message, "fix: one-liner");
});

test("giving both forms is refused rather than letting one silently win", () => {
  const path = fileWith("both.txt", "from the file");
  assert.throws(
    () => flagInput("task", "commit", ["task", "commit", "--id", "T", "--message", "inline", "--message-file", path]),
    /--message and --message-file cannot both be given/,
  );
});

test("an unreadable file names itself instead of failing as a missing value", () => {
  assert.throws(
    () => flagInput("task", "commit", ["task", "commit", "--id", "T", "--message-file", join(scratch, "absent.txt")]),
    /--message-file could not be read/,
  );
});

test("a BOM is stripped, so a PowerShell-written subject line is not invisibly corrupted", () => {
  const path = fileWith("bom.txt", "﻿fix: subject\n\nbody\n");
  assert.equal(readTextValue(["--message-file", path], "--message"), "fix: subject\n\nbody");
});
