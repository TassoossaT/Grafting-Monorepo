import assert from "node:assert/strict";
import test from "node:test";
import { flagInput } from "./flag-input.ts";

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
