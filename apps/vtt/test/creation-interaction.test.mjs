import assert from "node:assert/strict";
import test from "node:test";

import {
  firstRefusal,
  resolveCoverage,
  resolveCreationInteraction,
} from "../src/features/edit-construction/index.ts";

function covered(surfaceType, coverage = "centroid") {
  return {
    surfaceKey: ["@region", `${surfaceType}-1`],
    surfaceType,
    physical: true,
    coverage,
    centroid: { x: 0, y: 0, z: 0 },
    nodeIds: ["a", "b", "c", "d"],
  };
}

/**
 * The central rule: the relation is directional. Declaring that a wall may
 * stand on terrain says nothing about terrain standing on a wall, so both
 * directions are declared, and they disagree.
 */
test("a wall goes on terrain, but terrain does not go on a wall", () => {
  assert.equal(resolveCreationInteraction("wall-white", "terrain").kind, "ignore");

  const reverse = resolveCreationInteraction("terrain", "wall-white");
  assert.equal(reverse.kind, "forbid");
  assert.match(reverse.reason, /terrain cannot be created above/);
});

test("terrain over terrain restacks rather than overlaying a second lattice", () => {
  assert.equal(resolveCreationInteraction("terrain", "terrain").kind, "restack");
  assert.equal(resolveCreationInteraction("terrain", "terrain-grass").kind, "restack");
  assert.equal(resolveCreationInteraction("terrain-grass", "terrain").kind, "restack");
});

test("terrain refuses every non-ground type, not just walls", () => {
  for (const covered of ["wall-gray", "door", "floor", "ceiling", "path"]) {
    assert.equal(
      resolveCreationInteraction("terrain", covered).kind,
      "forbid",
      `terrain over ${covered} must be refused`,
    );
  }
});

test("a path carves whatever it crosses -- terrain as a road, a wall as an opening", () => {
  assert.equal(resolveCreationInteraction("path", "terrain").kind, "cut");
  assert.equal(resolveCreationInteraction("path", "wall-white").kind, "cut");
});

test("a path over a path is cut and regenerated as one formation", () => {
  assert.equal(resolveCreationInteraction("path", "path").kind, "cut");
});

test("a panel never consumes what it stands on, whatever that is", () => {
  for (const painted of ["wall-white", "wall-gray", "door", "floor", "ceiling"]) {
    for (const under of ["terrain", "path", "wall-gray"]) {
      assert.equal(resolveCreationInteraction(painted, under).kind, "ignore");
    }
  }
});

/**
 * Silently stacking on top of something nobody declared is exactly how
 * geometry accumulates unnoticed -- the defect this whole table exists to
 * prevent -- so an unknown type is refused, in either position.
 */
test("an undeclared type is refused rather than defaulting to ignore", () => {
  assert.equal(resolveCreationInteraction("mystery", "terrain").kind, "forbid");
  assert.equal(resolveCreationInteraction("terrain", "mystery").kind, "forbid");
});

test("resolveCoverage pairs every touched region with its own resolution", () => {
  const resolved = resolveCoverage("path", [covered("terrain"), covered("wall-white", "overlap")]);

  assert.deepEqual(
    resolved.map((entry) => [entry.covered.surfaceType, entry.interaction.kind, entry.covered.coverage]),
    [
      ["terrain", "cut", "centroid"],
      ["wall-white", "cut", "overlap"],
    ],
  );
});

test("firstRefusal surfaces why a stroke must be abandoned whole", () => {
  const resolved = resolveCoverage("terrain", [covered("terrain"), covered("wall-white")]);

  assert.equal(resolved[0].interaction.kind, "restack");
  assert.match(
    firstRefusal(resolved),
    /terrain cannot be created above/,
    "one refusal condemns the stroke -- terraforming everything except the wall would be worse",
  );
});

test("firstRefusal is undefined when every region resolved", () => {
  assert.equal(firstRefusal(resolveCoverage("terrain", [covered("terrain")])), undefined);
});
