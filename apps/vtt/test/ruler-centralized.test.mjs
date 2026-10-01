import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

/**
 * The ruler is one thing, and it stays one. Whatever resolves a point, a
 * height, a turn or a line-up -- or measures an edit -- lives in the ruler's
 * own modules and is reached through one door (`tools/core/ruler.ts`). A tool,
 * a handle or a drag that imports a resolver itself, or shows a ruler by its
 * own means, is a second ruler growing: this fails it, the way
 * `no-type-name-comparisons` fails a branch on a type's name.
 */

const sourceRoot = resolve(import.meta.dirname, "../src");

/** What resolves, rounds or measures: reachable only through the ruler's door. */
const RESOLVERS = [
  "resolveRuler", "resolveLevel", "roundWithin", "snapTurn", "catchOnAxis", "gapCenter", "gapsAround", "holdsOnAxis",
  "measuresOfEdit", "editMeasureOf", "baseHeight", "dimensionsOf", "snapToOutlines",
  "LEVEL_REACH", "RULER_REACH", "SNAP_REACH",
];
/** The ruler's own session and presenter: only the door and the dispatcher that draws it may reach them. */
const INTERNALS = ["ruler-session.ts", "ruler-preview.ts", "ruler-labels.ts"];

const inside = (path) => path.split(sep).join("/");
const rulerModules = (path) => path.startsWith("features/edit-construction/ruler/") || /^composition\/tabletop\/tools\/core\/ruler(-session|-preview|-labels)?\.ts$/.test(path);
/** The dispatcher draws the ruler for every pointer sample, so it may hold the session and the presenter -- not the resolvers. */
const dispatcher = (path) => path === "composition/tabletop/use-construction-pointer.ts";

async function sources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sources(full)));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every `import ... from "path"` of `text`, with the names it takes. */
function importsOf(text) {
  const found = [];
  for (const match of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
    found.push({ names: match[1].split(",").map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean), from: match[2] });
  }
  for (const match of text.matchAll(/import\s+(?:type\s+)?[\w*]+[^;{]*from\s+["']([^"']+)["']/g)) found.push({ names: [], from: match[1] });
  return found;
}

test("nothing outside the ruler's own modules imports what resolves, rounds or measures", async () => {
  const offenders = [];
  for (const file of await sources(sourceRoot)) {
    const path = inside(relative(sourceRoot, file));
    if (rulerModules(path)) continue;
    for (const { names } of importsOf(await readFile(file, "utf8"))) {
      const taken = names.filter((name) => RESOLVERS.includes(name));
      if (taken.length > 0) offenders.push(`${path}: ${taken.join(", ")}`);
    }
  }
  assert.deepEqual(offenders, [], `reach the ruler through tools/core/ruler.ts (rulerOf), not by importing its resolvers:\n${offenders.join("\n")}`);
});

test("the ruler's session and presenter are reached only through its door and by the dispatcher", async () => {
  const offenders = [];
  for (const file of await sources(sourceRoot)) {
    const path = inside(relative(sourceRoot, file));
    if (rulerModules(path) || dispatcher(path)) continue;
    for (const { from } of importsOf(await readFile(file, "utf8"))) {
      if (INTERNALS.some((internal) => from.endsWith(internal))) offenders.push(`${path}: ${from}`);
    }
  }
  assert.deepEqual(offenders, [], `use rulerOf(ctx) -- ruler-session and ruler-preview are the ruler's own:\n${offenders.join("\n")}`);
});

test("a ruler is shown in one place: nothing but the door and the dispatcher calls showRuler", async () => {
  const offenders = [];
  for (const file of await sources(sourceRoot)) {
    const path = inside(relative(sourceRoot, file));
    if (rulerModules(path) || dispatcher(path) || path === "composition/tabletop/tools/core/tool-context.ts") continue;
    if (/\bshowRuler\b/.test(await readFile(file, "utf8"))) offenders.push(path);
  }
  assert.deepEqual(offenders, [], `show through rulerOf(ctx).show(...):\n${offenders.join("\n")}`);
});

test("every handle declares what it measures, so no gesture keeps a list of its own", async () => {
  const { HANDLE_MEASUREMENT } = await import("../src/features/edit-construction/index.ts");
  const text = await readFile(resolve(sourceRoot, "features/edit-construction/global-handles/global-handle-ids.ts"), "utf8");
  const kinds = [...text.match(/export type GlobalHandleKind =([^;]+);/)[1].matchAll(/"([a-zA-Z]+)"/g)].map((match) => match[1]);
  assert.ok(kinds.length >= 18, "the kinds were read");
  assert.deepEqual(Object.keys(HANDLE_MEASUREMENT).sort(), [...kinds].sort(), "a kind with no declaration, or a declaration for no kind");
});
