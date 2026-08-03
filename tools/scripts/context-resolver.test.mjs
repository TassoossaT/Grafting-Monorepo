import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractDecGateIds,
  formatContextDigest,
  matchAdrRows,
  matchDirectProjects,
  matchRouterRows,
  parseAdrIndexTable,
  parseProjectGraphRoots,
  parseRouterTable,
  resolveAgentsFiles,
  runNxAffected,
} from "./context-resolver.mjs";

test("extractDecGateIds finds every unique DEC/GATE id, ignoring near-misses", () => {
  const text = "Fixes GATE-004 per DEC-053, restates DEC-053 again, but not DEC-5 or GATEX-001.";
  assert.deepEqual(extractDecGateIds(text), ["GATE-004", "DEC-053"]);
});

test("extractDecGateIds returns an empty array for non-string input", () => {
  assert.deepEqual(extractDecGateIds(undefined), []);
});

test("parseProjectGraphRoots reads the real docs/generated/project-graph.json shape", () => {
  const graphJson = { graph: { nodes: { ui: { data: { root: "packages/ui" } }, grafting: { data: { root: "." } } } } };
  assert.deepEqual(parseProjectGraphRoots(graphJson), { ui: "packages/ui", grafting: "." });
});

test("parseProjectGraphRoots tolerates a flat { nodes } shape too", () => {
  const graphJson = { nodes: { ui: { data: { root: "packages/ui" } } } };
  assert.deepEqual(parseProjectGraphRoots(graphJson), { ui: "packages/ui" });
});

test("matchDirectProjects matches a path under a project's root", () => {
  const rootsMap = { ui: "packages/ui", "architecture-studio": "apps/architecture-studio", grafting: "." };
  assert.deepEqual(matchDirectProjects(["packages/ui/src/index.ts"], rootsMap), ["ui"]);
});

test("matchDirectProjects never matches the workspace-root project via the empty-prefix trick", () => {
  const rootsMap = { grafting: "." };
  assert.deepEqual(matchDirectProjects(["anything/at/all.ts"], rootsMap), []);
});

test("matchDirectProjects does not match a sibling package with a similar name prefix", () => {
  const rootsMap = { ui: "packages/ui", "ui-extra": "packages/ui-extra" };
  assert.deepEqual(matchDirectProjects(["packages/ui-extra/src/index.ts"], rootsMap), ["ui-extra"]);
});

test("parseRouterTable parses GRAFTING_MASTER_SOURCE.md's own S0.4 table", () => {
  const text = [
    "### 0.4 Router",
    "",
    "| § | Topic | Location |",
    "| - | ----- | -------- |",
    "| 1 | Product vision | moved -> `docs/architecture/overview.md` |",
    "| 2 | Architectural principles | inline below |",
    "",
    "Trailing prose after the table.",
  ].join("\n");
  assert.deepEqual(parseRouterTable(text), [
    { section: "1", topic: "Product vision", location: "moved -> `docs/architecture/overview.md`" },
    { section: "2", topic: "Architectural principles", location: "inline below" },
  ]);
});

test("parseRouterTable returns an empty array when the table header is absent", () => {
  assert.deepEqual(parseRouterTable("no table here"), []);
});

test("matchRouterRows matches a row whose topic text appears in the task text", () => {
  const rows = [{ section: "16", topic: "Knowledge, documentation, and context for AI", location: "x" }];
  const taskText = "Build a tool for Knowledge, documentation, and context for AI resolution.";
  assert.deepEqual(matchRouterRows(taskText, rows), rows);
});

test("matchRouterRows excludes rows whose topic does not appear in the task text", () => {
  const rows = [{ section: "20", topic: "Observability", location: "x" }];
  assert.deepEqual(matchRouterRows("Unrelated task about UI cards.", rows), []);
});

test("parseAdrIndexTable parses docs/adr/README.md's own index table", () => {
  const text = [
    "| ADR | Gate | Subject | Status |",
    "| --- | --- | --- | --- |",
    "| [ADR-0005](ADR-0005-authoritative-host-deferral.md) | GATE-004 | Formal deferral | **Accepted (DEC-XXX)** |",
  ].join("\n");
  assert.deepEqual(parseAdrIndexTable(text), [
    {
      adr: "ADR-0005",
      file: "ADR-0005-authoritative-host-deferral.md",
      gate: "GATE-004",
      subject: "Formal deferral",
      status: "**Accepted (DEC-XXX)**",
    },
  ]);
});

test("matchAdrRows matches by Gate id", () => {
  const rows = [{ adr: "ADR-0005", file: "f.md", gate: "GATE-004", subject: "s", status: "st" }];
  assert.deepEqual(matchAdrRows(["GATE-004"], rows), rows);
});

test("matchAdrRows matches by DEC id embedded in the Status cell", () => {
  const rows = [{ adr: "ADR-0008", file: "f.md", gate: "—", subject: "s", status: "**Accepted (DEC-046)**" }];
  assert.deepEqual(matchAdrRows(["DEC-046"], rows), rows);
});

test("matchAdrRows returns nothing when no ids are mentioned", () => {
  const rows = [{ adr: "ADR-0008", file: "f.md", gate: "—", subject: "s", status: "**Accepted (DEC-046)**" }];
  assert.deepEqual(matchAdrRows([], rows), []);
});

test("resolveAgentsFiles always includes the root AGENTS.md and adds an existing project AGENTS.md", () => {
  const rootsMap = { ui: "packages/ui", grafting: "." };
  const exists = (path) => path.replaceAll("\\", "/").endsWith("packages/ui/AGENTS.md");
  assert.deepEqual(resolveAgentsFiles(["ui", "grafting"], rootsMap, "/repo", exists), [
    "AGENTS.md",
    "packages/ui/AGENTS.md",
  ]);
});

test("resolveAgentsFiles skips a project whose AGENTS.md does not exist on disk", () => {
  const rootsMap = { "isekai-dotnet-protocol": "dotnet/Grafting.Isekai.Protocol" };
  assert.deepEqual(resolveAgentsFiles(["isekai-dotnet-protocol"], rootsMap, "/repo", () => false), ["AGENTS.md"]);
});

test("runNxAffected parses the last JSON-array line, tolerating pnpm/nx preamble", () => {
  const fakeExec = () => "Lockfile is up to date\nsome noise\n[\"ui\",\"architecture-studio\"]\n";
  assert.deepEqual(runNxAffected(["packages/ui/src/index.ts"], { root: "/repo", exec: fakeExec }), [
    "ui",
    "architecture-studio",
  ]);
});

test("runNxAffected returns an empty array without shelling out when given no paths", () => {
  let called = false;
  const fakeExec = () => {
    called = true;
    return "[]";
  };
  assert.deepEqual(runNxAffected([], { root: "/repo", exec: fakeExec }), []);
  assert.equal(called, false);
});

test("runNxAffected returns an empty array when nothing parseable is found", () => {
  const fakeExec = () => "not json at all";
  assert.deepEqual(runNxAffected(["a.ts"], { root: "/repo", exec: fakeExec }), []);
});

test("formatContextDigest lists paths and reasons only, never inlined file content", () => {
  const digest = formatContextDigest({
    taskId: "SOME-TASK",
    agentsFiles: ["AGENTS.md", "packages/ui/AGENTS.md"],
    directProjects: [{ name: "ui", root: "packages/ui" }],
    affectedOnlyProjects: ["architecture-studio"],
    routerRows: [{ section: "16", topic: "Knowledge, documentation, and context for AI", location: "docs/architecture/ai-control-plane.md" }],
    adrRows: [{ adr: "ADR-0011", file: "ADR-0011-package-autonomy-and-external-isolation.md", gate: "—", subject: "Package autonomy", status: "Accepted" }],
  });
  assert.match(digest, /# Context resolution for SOME-TASK/);
  assert.match(digest, /- AGENTS\.md/);
  assert.match(digest, /- packages\/ui\/AGENTS\.md/);
  assert.match(digest, /- ui \(packages\/ui\)/);
  assert.match(digest, /- architecture-studio/);
  assert.match(digest, /S16 Knowledge, documentation, and context for AI -> docs\/architecture\/ai-control-plane\.md/);
  assert.match(digest, /ADR-0011 \(ADR-0011-package-autonomy-and-external-isolation\.md\) -- Package autonomy/);
  assert.match(digest, /index, not a substitute for reading the code/);
});

test("formatContextDigest omits empty sections entirely rather than printing empty headers", () => {
  const digest = formatContextDigest({
    taskId: null,
    agentsFiles: ["AGENTS.md"],
    directProjects: [],
    affectedOnlyProjects: [],
    routerRows: [],
    adrRows: [],
  });
  assert.doesNotMatch(digest, /Directly touched/);
  assert.doesNotMatch(digest, /Also affected/);
  assert.doesNotMatch(digest, /router entries/);
  assert.doesNotMatch(digest, /Relevant ADRs/);
});
