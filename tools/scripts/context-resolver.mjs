// Materializes the "context pack" concept named in
// docs/architecture/ai-control-plane.md S16.9 (DEC-050) but never
// implemented: given a task's own declared affected_paths (DEC-031), resolve
// the small slice of AGENTS.md/router-table/ADR pointers actually relevant
// to it, instead of an agent reading broadly. Backed by Nx's own project
// graph (DEC-021 -- already treated as derived structural context, zero new
// dependency), not a new indexer. Every function here only lists paths and
// one-line reasons -- it never inlines file content, matching S16.9's "an
// index, not a substitute for reading the code."
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ID_PATTERN = /\b(DEC|GATE)-\d{3}\b/g;

/** Every DEC-XXX/GATE-XXX id mentioned in a piece of text, de-duplicated, in first-seen order. */
export function extractDecGateIds(text) {
  if (typeof text !== "string") return [];
  return [...new Set(text.match(ID_PATTERN) ?? [])];
}

/** Reads docs/generated/project-graph.json's own shape into a flat { [projectName]: root } map. */
export function parseProjectGraphRoots(graphJson) {
  const nodes = graphJson?.graph?.nodes ?? graphJson?.nodes ?? {};
  const roots = {};
  for (const [name, node] of Object.entries(nodes)) {
    if (typeof node?.data?.root === "string") roots[name] = node.data.root;
  }
  return roots;
}

/**
 * Project names whose root is a prefix of at least one of the given
 * repository-relative paths. Skips the workspace-root project (root ".") --
 * every path trivially "starts with" it, so it's not a meaningful per-task
 * signal; the real Nx affected computation decides independently whether
 * the aggregate root project is genuinely affected.
 */
export function matchDirectProjects(paths, rootsMap) {
  const matches = new Set();
  for (const [name, root] of Object.entries(rootsMap)) {
    if (root === ".") continue;
    const prefix = `${root}/`;
    if (paths.some((path) => path === root || path.startsWith(prefix))) matches.add(name);
  }
  return [...matches];
}

const ROUTER_HEADER_PATTERN = /^\|\s*§\s*\|\s*Topic\s*\|\s*Location\s*\|\s*$/;
const ROUTER_ROW_PATTERN = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/;

/** Parses GRAFTING_MASTER_SOURCE.md's own S0.4 router table into [{ section, topic, location }]. */
export function parseRouterTable(masterSourceText) {
  const lines = masterSourceText.split("\n");
  const headerIndex = lines.findIndex((line) => ROUTER_HEADER_PATTERN.test(line));
  if (headerIndex === -1) return [];

  const rows = [];
  // Row immediately after the header is the `| - | ----- | -------- |` separator; skip it.
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const match = ROUTER_ROW_PATTERN.exec(lines[index]);
    if (!match) break;
    rows.push({ section: match[1], topic: match[2], location: match[3] });
  }
  return rows;
}

/** Router rows whose topic text plausibly relates to the given task text (title + objective). */
export function matchRouterRows(taskText, rows) {
  const haystack = taskText.toLowerCase();
  return rows.filter((row) => haystack.includes(row.topic.toLowerCase()));
}

const ADR_ROW_PATTERN =
  /^\|\s*\[(ADR-\d+)]\(([^)]+)\)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/;

/** Parses docs/adr/README.md's own index table into [{ adr, file, gate, subject, status }]. */
export function parseAdrIndexTable(adrReadmeText) {
  const rows = [];
  for (const line of adrReadmeText.split("\n")) {
    const match = ADR_ROW_PATTERN.exec(line);
    if (match) rows.push({ adr: match[1], file: match[2], gate: match[3], subject: match[4], status: match[5] });
  }
  return rows;
}

/** ADR rows whose Gate/Status cell mentions one of the given DEC-XXX/GATE-XXX ids -- id-based, not fuzzy keyword search. */
export function matchAdrRows(idsMentioned, rows) {
  if (idsMentioned.length === 0) return [];
  return rows.filter((row) => idsMentioned.some((id) => row.gate.includes(id) || row.status.includes(id)));
}

/** Root AGENTS.md (always, per DEC-024) plus each matched project's own local AGENTS.md, when one exists on disk. */
export function resolveAgentsFiles(projectNames, rootsMap, root, exists = existsSync) {
  const files = ["AGENTS.md"];
  for (const name of projectNames) {
    const projectRoot = rootsMap[name];
    if (!projectRoot || projectRoot === ".") continue;
    const candidate = `${projectRoot}/AGENTS.md`;
    if (exists(resolve(root, candidate))) files.push(candidate);
  }
  return [...new Set(files)];
}

/** Shells out to Nx's own affected-project computation for a set of changed paths; never touches source. */
export function runNxAffected(paths, { root, exec = execFileSync } = {}) {
  if (paths.length === 0) return [];
  const stdout = exec(
    "nx",
    ["show", "projects", "--affected", `--files=${paths.join(",")}`, "--json"],
    { cwd: root, encoding: "utf8", shell: true },
  );
  // Nx may print diagnostic preamble before the JSON payload;
  // the payload is always the last successfully-parseable JSON line.
  const lines = stdout.split("\n").filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not the JSON payload line -- keep scanning upward through preamble.
    }
  }
  return [];
}

/** Renders the resolved context as a Markdown digest: paths and one-line reasons only, never inlined content. */
export function formatContextDigest({
  taskId,
  agentsFiles,
  directProjects,
  affectedOnlyProjects,
  routerRows,
  adrRows,
}) {
  const lines = [`# Context resolution${taskId ? ` for ${taskId}` : ""}`, ""];

  lines.push("## AGENTS.md files to read");
  for (const file of agentsFiles) lines.push(`- ${file}`);

  if (directProjects.length > 0) {
    lines.push("", "## Directly touched Nx projects");
    for (const { name, root } of directProjects) lines.push(`- ${name} (${root})`);
  }

  if (affectedOnlyProjects.length > 0) {
    lines.push("", "## Also affected via the Nx dependency graph (not directly touched)");
    for (const name of affectedOnlyProjects) lines.push(`- ${name}`);
  }

  if (routerRows.length > 0) {
    lines.push("", "## Relevant GRAFTING_MASTER_SOURCE.md router entries (S0.4)");
    for (const row of routerRows) lines.push(`- S${row.section} ${row.topic} -> ${row.location}`);
  }

  if (adrRows.length > 0) {
    lines.push("", "## Relevant ADRs");
    for (const row of adrRows) lines.push(`- ${row.adr} (${row.file}) -- ${row.subject}`);
  }

  lines.push(
    "",
    "This is an index, not a substitute for reading the code (S16.9) -- read only the files actually needed for the task at hand.",
  );
  return lines.join("\n");
}

const STATUS_DIRECTORIES = ["planned", "in_progress", "blocked", "completed", "cancelled"];

function findTaskRecordPath(root, taskId) {
  for (const status of STATUS_DIRECTORIES) {
    const candidate = resolve(root, ".ai/state/tasks", status, `${taskId}.json`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Resolves the full context digest for a task ID or an explicit path list -- the shared core for both the manual CLI and the PostToolUse hook. */
export function resolveContext({ root, taskId = null, paths = null, exec = execFileSync }) {
  let affectedPathsInput = paths ?? [];
  let taskText = "";

  if (taskId) {
    const recordPath = findTaskRecordPath(root, taskId);
    if (!recordPath) throw new Error(`no task record found for ${taskId}`);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    affectedPathsInput = record.affected_paths ?? [];
    taskText = `${record.title ?? ""}\n${record.objective ?? ""}`;
  }

  const graphJson = JSON.parse(readFileSync(resolve(root, "docs/generated/project-graph.json"), "utf8"));
  const rootsMap = parseProjectGraphRoots(graphJson);
  const directProjectNames = matchDirectProjects(affectedPathsInput, rootsMap);

  let affectedProjectNames = [];
  try {
    affectedProjectNames = runNxAffected(affectedPathsInput, { root, exec });
  } catch {
    affectedProjectNames = [];
  }
  const affectedOnlyProjects = affectedProjectNames.filter((name) => !directProjectNames.includes(name));

  const allProjectNames = [...new Set([...directProjectNames, ...affectedProjectNames])];
  const agentsFiles = resolveAgentsFiles(allProjectNames, rootsMap, root);

  const masterSourceText = readFileSync(resolve(root, "GRAFTING_MASTER_SOURCE.md"), "utf8");
  const routerRows = taskText ? matchRouterRows(taskText, parseRouterTable(masterSourceText)) : [];

  const adrReadmeText = readFileSync(resolve(root, "docs/adr/README.md"), "utf8");
  const adrRows = taskText
    ? matchAdrRows(extractDecGateIds(taskText), parseAdrIndexTable(adrReadmeText))
    : [];

  return formatContextDigest({
    taskId,
    agentsFiles,
    directProjects: directProjectNames.map((name) => ({ name, root: rootsMap[name] })),
    affectedOnlyProjects,
    routerRows,
    adrRows,
  });
}

function parseArguments(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("expected --root/--task/--paths <value>");
    values[key.slice(2)] = value;
  }
  return values;
}

export function main(argv_ = process.argv.slice(2)) {
  const options = parseArguments(argv_);
  const root = resolve(options.root ?? ".");
  const paths = options.paths ? options.paths.split(",").map((path) => path.trim()).filter(Boolean) : null;

  if (!options.task && !paths) {
    console.error("usage: context-resolver.mjs --task <TASK_ID> | --paths a.ts,b.rs [--root <path>]");
    return 1;
  }

  console.log(resolveContext({ root, taskId: options.task ?? null, paths }));
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
