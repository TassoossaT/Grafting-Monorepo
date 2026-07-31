// I-004 (master source S16.7/S23): the real Nx -> Graph IR v1 extractor.
// Produces docs/generated/grafting.graph.json, conforming to
// docs/graph-ir/graph-ir-v1.schema.json. Scope is deliberately Nx-sourced
// only -- project/target nodes, contains/depends_on edges -- matching the
// backlog item's own title ("Nx -> Graph IR extractor") and criterion
// ("reproducible projects/targets/edges"). Task/agent/handoff coverage
// stays in the frozen spike file (generate-graph-ir.mjs); see the
// I-004-GRAPH-IR-EXTRACTOR task record for why. Exported as a library
// (`extractGraphIr`, `jsonPointerEscape`) so tests can exercise pieces
// directly (see graph-ir-extract.test.mjs), matching
// generate-rust-crate.mjs's established shape: plain Node ESM, no new
// dependencies, deterministic output, a --check flag.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validateGraphIrDocument } from "./validate-graph-ir.mjs";

const root = resolve(import.meta.dirname, "../..");
const outputPath = resolve(root, "docs/generated/grafting.graph.json");

const readText = (relative) => readFile(resolve(root, relative), "utf8");
const canonical = (value) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export const jsonPointerEscape = (key) => key.replace(/~/g, "~0").replace(/\//g, "~1");

const EXTRACTOR = { id: "extractor:nx-graph-ir", version: "1.0.0" };

function git(args) {
  // Porcelain status uses its first two columns as meaningful state. Preserve
  // a leading workspace-column space on the first line while removing only
  // Git's trailing newline.
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
}

export const pathsFromGitPorcelain = (status) =>
  [...new Set(status.split("\n").filter(Boolean).map((line) => line.slice(3).trim()))].sort();

/**
 * Builds the real Graph IR v1 document from the committed Nx project graph
 * and each project's manifest, self-checks it against both validation
 * layers (JS schema/semantics + Rust structural invariants, per DEC-051),
 * and either writes it (default) or diffs it against the committed file
 * without writing (`check: true`). Returns the document either way.
 */
export async function extractGraphIr({ check = false } = {}) {
  // Nx's own committed export; nothing in this repo regenerates it
  // automatically -- the same convention generate-graph-ir.mjs and
  // generate-repo-map.mjs already follow.
  const projectGraphRelative = "docs/generated/project-graph.json";
  const projectGraphText = await readText(projectGraphRelative);
  const projectGraphSha = sha256(projectGraphText);
  const nx = JSON.parse(projectGraphText).graph;

  const projectNames = Object.keys(nx.nodes).sort();

  // Resolve each project's manifest: prefer project.json, fall back to
  // package.json for the one real case with no project.json
  // (@grafting/isekai-wasm -- confirmed empirically; every other current
  // project has project.json). The repo-root project's own Nx root is
  // "." (the "grafting" project, G-TOOLING-NX-ROOT-TARGETS) -- joining
  // that with a leading "./" produces a "." path segment, which
  // validate-graph-ir.mjs's validateEvidencePath rejects as unnormalized;
  // join without a separator in that one case instead.
  const joinRepoRelative = (projectRoot, file) => (projectRoot === "." ? file : `${projectRoot}/${file}`);
  const manifestRelativeFor = (projectRoot) => {
    const projectJson = joinRepoRelative(projectRoot, "project.json");
    return existsSync(resolve(root, projectJson)) ? projectJson : joinRepoRelative(projectRoot, "package.json");
  };

  const manifestByProject = new Map();
  for (const name of projectNames) {
    const path = manifestRelativeFor(nx.nodes[name].data.root);
    const text = await readText(path);
    const parsed = JSON.parse(text);
    manifestByProject.set(name, {
      path,
      text,
      sha256: sha256(text),
      declaredTargets: new Set(Object.keys(parsed.targets ?? {})),
      declaredImplicitDependencies: new Set(parsed.implicitDependencies ?? []),
    });
  }

  // --- sourceRevision -----------------------------------------------
  // Scoped strictly to this extractor's own real inputs (project-graph.json
  // + every manifest read), never a whole-repo `git status` scan. A
  // repo-wide scan would be self-referential: this generator's own output
  // file becomes part of the working tree the moment it's first written,
  // so a later run's "whole tree" fingerprint would never match the one
  // already embedded in the file on disk, and --check could never
  // converge. Scoping to a known, fixed input-file list avoids that, and
  // also keeps this fingerprint from shifting because of unrelated
  // concurrent agent work elsewhere in the repo.
  const headSha = git(["rev-parse", "HEAD"]);
  const inputPaths = [...new Set([projectGraphRelative, ...[...manifestByProject.values()].map((m) => m.path)])].sort();
  const dirtyStatus = git(["status", "--porcelain=v1", "--", ...inputPaths]);
  let sourceRevision;
  if (dirtyStatus === "") {
    sourceRevision = `git:${headSha}`;
  } else {
    const dirtyPaths = pathsFromGitPorcelain(dirtyStatus);
    const lines = await Promise.all(dirtyPaths.map(async (path) => `${path} ${sha256(await readText(path))}`));
    sourceRevision = `workspace:sha256:${sha256(`${headSha}\n${lines.join("\n")}`)}`;
  }

  const provenance = (confidence, evidence) => ({ extractor: EXTRACTOR, sourceRevision, confidence, evidence });

  // --- nodes and contains edges --------------------------------------
  const nodes = [];
  const edges = [];

  for (const name of projectNames) {
    const nxNode = nx.nodes[name];
    const manifest = manifestByProject.get(name);

    nodes.push({
      id: `project:${name}`,
      kind: "project",
      authorityClass: "canonical_authored_source",
      level: "L0",
      label: nxNode.data.metadata?.graphIr?.id ?? name,
      tags: [...(nxNode.data.tags ?? [])].sort(),
      provenance: provenance(1, [
        { kind: "manifest", path: manifest.path, pointer: "/name", sha256: manifest.sha256 },
      ]),
    });

    const targetNames = Object.keys(nxNode.data.targets ?? {}).sort();
    for (const targetName of targetNames) {
      const targetId = `target:${name}/${targetName}`;
      // Most targets are declared directly in the project's own manifest.
      // A small real exception exists today (architecture-studio's `dev`
      // target is Nx-plugin-inferred, absent from its project.json) --
      // confirmed empirically, not assumed. Inferred targets are
      // derived_evidence/"derived" (an Nx projection), not
      // canonical_authored_source/"declared" (nothing authors them as a
      // single declaration), with evidence pointing at the Nx export
      // instead of a manifest that doesn't actually contain the key.
      const declared = manifest.declaredTargets.has(targetName);
      const authorityClass = declared ? "canonical_authored_source" : "derived_evidence";
      const relationClass = declared ? "declared" : "derived";
      const confidence = declared ? 1 : 0.95;
      const evidence = declared
        ? [{ kind: "manifest", path: manifest.path, pointer: `/targets/${jsonPointerEscape(targetName)}`, sha256: manifest.sha256 }]
        : [{
            kind: "generated",
            path: projectGraphRelative,
            pointer: `/graph/nodes/${jsonPointerEscape(name)}/data/targets/${jsonPointerEscape(targetName)}`,
            sha256: projectGraphSha,
          }];

      nodes.push({
        id: targetId,
        kind: "target",
        authorityClass,
        label: targetName,
        tags: [],
        provenance: provenance(confidence, evidence),
      });
      edges.push({
        id: `edge:${encodeURIComponent(`project:${name}`)}--contains--${encodeURIComponent(targetId)}`,
        kind: "contains",
        source: `project:${name}`,
        target: targetId,
        relationClass,
        provenance: provenance(confidence, evidence),
      });
    }
  }

  // --- depends_on edges -------------------------------------------------
  // Nx records the same (source,target) pair under multiple dependency
  // `type`s in real, current data (e.g. architecture-studio->graph-x6 has
  // both "implicit" and "static"; graph-x6->x6-canvas the same). The v1
  // canonical edge ID (edge:<source>--<kind>--<target>) has no room for a
  // type suffix, so pairs are collapsed to exactly one edge each:
  // "declared" if an authored implicitDependencies entry exists for the
  // pair, else "derived" from Nx's own static-analysis inference alone
  // (confirmed real case: isekai-web-client -> @grafting/isekai-wasm is
  // static-only).
  for (const source of projectNames) {
    const dependencies = nx.dependencies[source] ?? [];
    const typesByTarget = new Map();
    for (const dependency of dependencies) {
      const types = typesByTarget.get(dependency.target) ?? new Set();
      types.add(dependency.type);
      typesByTarget.set(dependency.target, types);
    }
    const manifest = manifestByProject.get(source);
    for (const target of [...typesByTarget.keys()].sort()) {
      const declared = manifest.declaredImplicitDependencies.has(target);
      const relationClass = declared ? "declared" : "derived";
      const confidence = declared ? 1 : 0.95;
      const evidence = declared
        ? [{ kind: "manifest", path: manifest.path, pointer: "/implicitDependencies", sha256: manifest.sha256 }]
        : [{
            kind: "generated",
            path: projectGraphRelative,
            pointer: `/graph/dependencies/${jsonPointerEscape(source)}`,
            sha256: projectGraphSha,
          }];
      edges.push({
        id: `edge:${encodeURIComponent(`project:${source}`)}--depends_on--${encodeURIComponent(`project:${target}`)}`,
        kind: "depends_on",
        source: `project:${source}`,
        target: `project:${target}`,
        relationClass,
        provenance: provenance(confidence, evidence),
      });
    }
  }

  nodes.sort((left, right) => left.id.localeCompare(right.id));
  edges.sort((left, right) => left.id.localeCompare(right.id));

  const inputHash = sha256([projectGraphText, ...[...manifestByProject.values()].map((m) => m.text)].join(""));

  const document = {
    schemaVersion: "1.0.0",
    graphId: "grafting.workspace",
    sourceRevision,
    generator: { ...EXTRACTOR, inputHash },
    nodes,
    edges,
  };

  // Self-check before writing, both layers. Per DEC-051, Rust
  // grafting-graph-core is authoritative for structural invariants (unique
  // IDs, edge endpoint existence) -- TypeScript must not reimplement them,
  // so this calls the real graph-ir-cli binary rather than hand-rolling a
  // duplicate-ID guard here.
  await validateGraphIrDocument(document);

  const rendered = canonical(document);
  if (check) {
    const existing = await readFile(outputPath, "utf8");
    if (existing !== rendered) throw new Error("grafting.graph.json is stale; run `pnpm graph:extract`");
  } else {
    await writeFile(outputPath, rendered);
  }

  execFileSync(
    "cargo",
    [
      "run",
      "-p",
      "grafting-graph-core",
      "--features",
      "graph-ir-cli",
      "--bin",
      "validate-graph-ir",
      "--",
      "docs/generated/grafting.graph.json",
    ],
    { cwd: root, stdio: "inherit" },
  );

  return document;
}

async function main() {
  const check = process.argv.includes("--check");
  const document = await extractGraphIr({ check });
  console.log(
    `${check ? "grafting.graph.json is current" : "Generated docs/generated/grafting.graph.json"}: ${document.nodes.length} nodes, ${document.edges.length} edges`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
