import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { STRUCTURE_TYPE_DEFINITIONS } from "../src/features/edit-construction/structure-types/registry.ts";

/**
 * The rule these tests hold: a structure type reacts to what another type is
 * *for* (its traits), never to which type it is. Code outside the registry
 * that compares, switches on or collects type names is the knowledge that
 * spreads until every new type or operation means editing many files.
 *
 * Ask `hasTrait(surfaceType, trait)` instead. A type finding its own faces
 * compares against its own identity constant (`PATH_SURFACE_TYPE`,
 * `platformStructureType.surfaceType`), which this scan does not flag; using
 * another type's constant to fake a relation is the same mistake by a longer
 * route.
 *
 * `KNOWN_VIOLATIONS` is the debt that existed when the rule was introduced.
 * It may only shrink: a file above its count fails, and a file below it fails
 * too until its entry is lowered, so fixed debt cannot quietly come back.
 */
const KNOWN_VIOLATIONS = {
  // Placeholder colors per type; moves to the visual registry (Epic 4).
  "entities/map/surface-covering.ts": 1,
};

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const REGISTRY = "features/edit-construction/structure-types/registry.ts";

const names = STRUCTURE_TYPE_DEFINITIONS.map((definition) => definition.surfaceType)
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[-]/g, "\\-"))
  .join("|");
const TYPE_IDENTIFIER = String.raw`[\w.]*(?:surface|covered|painted|source|target)Type\b`;
const QUOTE = `["'\`]`;

const PATTERNS = [
  // `topology.surfaceType === "platform"`, either side.
  new RegExp(String.raw`${TYPE_IDENTIFIER}\s*[!=]==?\s*${QUOTE}`, "gi"),
  new RegExp(String.raw`${QUOTE}\s*[!=]==?\s*${TYPE_IDENTIFIER}`, "gi"),
  // `switch (surfaceType)`.
  new RegExp(String.raw`switch\s*\(\s*${TYPE_IDENTIFIER}\s*\)`, "gi"),
  // `new Set(["terrain", ...])`, `["terrain", ...].filter`.
  new RegExp(String.raw`\[\s*${QUOTE}(?:${names})${QUOTE}\s*,`, "g"),
  // `.has("wall-white")`, `.includes("path")`, `.startsWith("terrain")`.
  new RegExp(String.raw`\.(?:has|includes|startsWith)\(\s*${QUOTE}(?:${names})`, "g"),
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function violations() {
  const found = {};
  for (const file of sourceFiles(SRC)) {
    const key = relative(SRC, file).replaceAll("\\", "/");
    if (key === REGISTRY) continue;
    const text = readFileSync(file, "utf8");
    const count = PATTERNS.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);
    if (count > 0) found[key] = count;
  }
  return found;
}

test("no code outside the registry compares, switches on or collects structure type names", () => {
  const found = violations();
  const problems = [];
  for (const [file, count] of Object.entries(found)) {
    const allowed = KNOWN_VIOLATIONS[file] ?? 0;
    if (count > allowed) problems.push(`${file}: ${count} type-name comparison(s), ${allowed} allowed -- ask hasTrait() instead`);
  }
  for (const [file, allowed] of Object.entries(KNOWN_VIOLATIONS)) {
    const count = found[file] ?? 0;
    if (count < allowed) problems.push(`${file}: now ${count}, lower KNOWN_VIOLATIONS from ${allowed}`);
  }
  assert.deepEqual(problems, []);
});

test("the scan recognizes the shapes it forbids", () => {
  const samples = [
    `if (topology.surfaceType === "platform") {}`,
    `if ("terrain" !== coveredType) {}`,
    `switch (surfaceType) {}`,
    `const WALLS = new Set(["wall-white", "wall-gray"]);`,
    `if (name.startsWith("terrain")) {}`,
  ];
  for (const sample of samples) {
    assert.ok(PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags).test(sample)), sample);
  }
  assert.equal(PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags).test(`if (params.openingKind === "door") {}`)), false);
});
