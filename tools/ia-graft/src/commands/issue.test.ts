import assert from "node:assert/strict";
import test from "node:test";
import {
  ghCloseReason,
  issueClose,
  issueDoctor,
  issueList,
  issueNew,
  issueTree,
  issueUpdate,
  issueUpdateConflict,
  issueView,
  planIssueEdit,
} from "./issue.ts";

test("issue list runs cleanly without throwing", async () => {
  const result = await issueList(process.cwd(), { limit: 5 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert.equal(typeof result.count, "number");
    assert(Array.isArray(result.issues));
  }
});

test("issue view validates required id", async () => {
  const result = await issueView(process.cwd(), { id: "" });
  assert.equal(result.ok, false);
});

test("issue new validates required title", async () => {
  const result = await issueNew(process.cwd(), { title: "", type: "task" });
  assert.equal(result.ok, false);
});

test("issue update validates required id", async () => {
  const result = await issueUpdate(process.cwd(), { id: "" });
  assert.equal(result.ok, false);
});

test("issue tree runs cleanly and returns tree array", async () => {
  const result = await issueTree(process.cwd(), { limit: 10 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert(Array.isArray(result.tree));
    assert(Array.isArray(result.orphans));
  }
});

test("issue doctor audits open issues without throwing", async () => {
  const result = await issueDoctor(process.cwd(), { limit: 10 });
  assert.equal(typeof result.ok, "boolean");
  if (result.ok) {
    assert(typeof result.passed === "boolean");
    assert(Array.isArray(result.diagnostics));
  }
});

test("issue close validates required id", async () => {
  const result = await (await import("./issue.ts")).issueClose(process.cwd(), { id: "" });
  assert.equal(result.ok, false);
});

test("close reasons map to the spelling gh issue close accepts", () => {
  assert.equal(ghCloseReason("completed"), "completed");
  assert.equal(ghCloseReason("not_planned"), "not planned");
  assert.equal(ghCloseReason("not planned"), undefined);
  assert.equal(ghCloseReason("toString"), undefined);
});

test("issue close rejects an unknown reason before calling gh", async () => {
  const result = await issueClose(process.cwd(), { id: 1, reason: "wontfix" as never });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid close reason/);
});

test("issue edit swaps single-value labels and sets title, milestone, and parent", () => {
  const args = planIssueEdit(
    "7",
    { id: 7, priority: "P1-high", area: "apps", title: "New title", milestone: "1.0", parent: 170 },
    ["priority: P3-low", "area: domains", "type: task"],
  );
  assert.deepEqual(args, [
    "issue", "edit", "7",
    "--remove-label", "area: domains", "--add-label", "area: apps",
    "--remove-label", "priority: P3-low", "--add-label", "priority: P1-high",
    "--title", "New title",
    "--milestone", "1.0",
    "--parent", "170",
  ]);
});

test("issue edit removes milestone and parent, and plans nothing when nothing changes", () => {
  assert.deepEqual(planIssueEdit("7", { id: 7, removeMilestone: true, removeParent: true }, []), [
    "issue", "edit", "7", "--remove-milestone", "--remove-parent",
  ]);
  assert.equal(planIssueEdit("7", { id: 7, comment: "only a comment" }, []), undefined);
});

test("issue update rejects contradictory milestone or parent edits before calling gh", async () => {
  assert.match(issueUpdateConflict({ id: 7, milestone: "1.0", removeMilestone: true }) ?? "", /milestone/);
  assert.match(issueUpdateConflict({ id: 7, parent: 170, removeParent: true }) ?? "", /parent/);
  assert.equal(issueUpdateConflict({ id: 7, milestone: "1.0", removeParent: true }), undefined);

  const result = await issueUpdate(process.cwd(), { id: 7, parent: 170, removeParent: true });
  assert.equal(result.ok, false);
});

test("issue list rejects an unknown state before calling gh", async () => {
  const result = await issueList(process.cwd(), { state: "merged" as never });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /invalid issue state/);
});

test("issue reopen validates required id", async () => {
  const result = await (await import("./issue.ts")).issueReopen(process.cwd(), { id: "" });
  assert.equal(result.ok, false);
});
