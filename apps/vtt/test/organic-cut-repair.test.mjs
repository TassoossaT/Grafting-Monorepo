import assert from "node:assert/strict";
import test from "node:test";

import { repairOrganicCut } from "../src/features/edit-construction/structure-types/organic/organic-cut-repair.ts";

/**
 * The repair deletes what the cut consumed and closes the hole that leaves
 * with the rim the engine reports -- it generates nothing.
 *
 * That is the whole contract, and these tests are written against it rather
 * than against any shape: what gets deleted, what scope the hole is looked
 * for in, and that the face registered over it adds no node and no edge. The
 * last one is the point -- ground that introduces no vertex cannot float, and
 * ground that walks the neighbour's own edges cannot leave a seam.
 */

/**
 * A terrain quad (T1) the cut consumes, a surviving neighbour (T2), and a
 * road (R1) laid across T1's ground. Once T1 is gone, the rim standing around
 * that hole is T2's edge on one side and R1's contour on the other -- which
 * is exactly why the repair has to name both sides.
 */
function createFakeRuntime() {
  const positions = new Map([
    ["n1", { x: 0, y: 0, z: 0 }],
    ["n2", { x: 4, y: 0, z: 0 }],
    ["n3", { x: 4, y: 0, z: 4 }],
    ["n4", { x: 0, y: 0, z: 4 }],
    ["road-a", { x: 1, y: 0, z: 0 }],
    ["road-b", { x: 3, y: 0, z: 0 }],
  ]);

  const regions = new Map([
    ["T1", { surfaceKey: ["@region", "T1"], surfaceType: "terrain", physical: true, nodes: ["n1", "n2", "n3", "n4"] }],
    ["T2", { surfaceKey: ["@region", "T2"], surfaceType: "terrain", physical: true, nodes: ["n2", "n3"] }],
    ["R1", { surfaceKey: ["@region", "R1"], surfaceType: "path", physical: true, nodes: ["road-a", "road-b"] }],
  ]);

  const deleted = [];
  const addedPatches = [];
  let scopeSeen;
  let loopsFor = () => [];
  let refuseFirstRegion = false;

  const runtime = {
    getRegionTopology(surfaceKey) {
      const key = surfaceKey.join("|");
      for (const region of regions.values()) {
        if (region.surfaceKey.join("|") !== key) continue;
        return {
          ...region,
          outerLoops: [region.nodes.map((id) => ({ startNodeId: id }))],
          holes: [],
          nodes: region.nodes.map((id) => ({ id, position: positions.get(id) })),
        };
      }
      return undefined;
    },
    applyRegionEdit(ops) {
      for (const op of ops) {
        if (op.kind !== "delete-region") continue;
        const key = op.surfaceKey.join("|");
        let found = false;
        for (const [id, region] of regions) {
          if (region.surfaceKey.join("|") !== key) continue;
          regions.delete(id);
          deleted.push(key);
          found = true;
        }
        // The real session throws on a key it never stored.
        if (!found) throw new Error(`unknown region ${key}`);
      }
    },
    getUnfilledLoops(scope) {
      scopeSeen = [...scope];
      return loopsFor(scope);
    },
    addPatch(patch) {
      addedPatches.push(patch);
      const createdSurfaceKeys = [];
      const skippedRegionIds = [];
      patch.regions.forEach((region, index) => {
        if (refuseFirstRegion && index === 0) skippedRegionIds.push(region.regionId);
        else createdSurfaceKeys.push(["@region", region.regionId]);
      });
      return { createdSurfaceKeys, skippedRegionIds };
    },
  };

  return {
    runtime,
    deleted,
    addedPatches,
    scope: () => scopeSeen,
    reportLoops: (loops) => { loopsFor = () => loops; },
    refuseFirstSubmittedRegion: () => { refuseFirstRegion = true; },
  };
}

/** The hole T1's removal leaves: T2's edge on one side, the road's contour on the other. */
function holeAroundT1(neighbours, suffix = "") {
  return {
    nodeIds: ["n2", "n3", "road-b", `road-a${suffix}`],
    centroid: { x: 2, y: 0, z: 2 },
    boundary: [
      { edgeId: "e:n2~n3", reversed: false },
      { edgeId: "e:n3~road-b", reversed: true },
      { edgeId: "e:road-b~road-a", reversed: false },
      { edgeId: "e:road-a~n2", reversed: true },
    ],
    neighbours,
  };
}

const TERRAIN_AROUND = [
  { surfaceType: "terrain", physical: true },
  { surfaceType: "terrain", physical: true },
  { surfaceType: "path", physical: true },
];

test("the hole is closed with the rim the engine reports, adding no node and no edge", () => {
  const context = createFakeRuntime();
  const hole = holeAroundT1(TERRAIN_AROUND);
  context.reportLoops([hole]);

  const rebuilt = repairOrganicCut(
    context.runtime,
    { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [{ id: "road-a", position: { x: 1, y: 0, z: 0 } }] },
    "cause-1",
  );

  assert.equal(rebuilt, 1);
  assert.deepEqual(context.deleted, ["@region|T1"], "only what the cut consumed; T2 and the road are untouched");

  const [patch] = context.addedPatches;
  // The whole point: nothing is generated. No vertex to float, no edge to
  // sit coincident with one already there.
  assert.deepEqual(patch.nodes, [], "the fill introduces no node");
  assert.deepEqual(patch.edges, [], "the fill introduces no edge");
  assert.equal(patch.regions.length, 1);
  assert.deepEqual(
    patch.regions[0].boundary,
    hole.boundary,
    "the face walks the engine's own oriented rim, verbatim -- direction included",
  );
});

test("the hole is looked for in the consumed nodes and the painter's together", () => {
  const context = createFakeRuntime();
  context.reportLoops([holeAroundT1(TERRAIN_AROUND)]);

  repairOrganicCut(
    context.runtime,
    {
      consumedSurfaceKeys: [["@region", "T1"]],
      paintedNodes: [
        { id: "road-a", position: { x: 1, y: 0, z: 0 } },
        { id: "road-b", position: { x: 3, y: 0, z: 0 } },
      ],
    },
    "cause-1",
  );

  // An edge counts as free boundary only when *both* its nodes are named, and
  // the hole's far side is the painter's own contour. Naming only the
  // consumed terrain finds no closed loop -- the cut happens and nothing
  // regenerates, which is exactly what the table saw.
  const scope = context.scope();
  for (const id of ["n1", "n2", "n3", "n4", "road-a", "road-b"]) {
    assert.ok(scope.includes(id), `${id} bounds the hole and has to be in scope`);
  }
});

test("the mended ground is made of whatever the faces around it are, not of the consumed type", () => {
  const context = createFakeRuntime();
  context.reportLoops([
    holeAroundT1([
      { surfaceType: "terrain-grass", physical: true },
      { surfaceType: "terrain-grass", physical: true },
      { surfaceType: "terrain", physical: true },
    ]),
  ]);

  repairOrganicCut(context.runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [] }, "cause-1");

  const [patch] = context.addedPatches;
  assert.equal(
    patch.regions[0].surfaceType,
    "terrain-grass",
    "a gap surrounded by grass comes back grass, whatever the consumed face happened to be",
  );
});

test("a hole the engine does not report is left alone", () => {
  const context = createFakeRuntime();
  context.reportLoops([]);

  const rebuilt = repairOrganicCut(context.runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [] }, "cause-1");

  assert.equal(rebuilt, 0);
  assert.deepEqual(context.deleted, ["@region|T1"], "the cut still happened; only the mend found nothing to do");
  assert.deepEqual(context.addedPatches, [], "and nothing was submitted rather than an empty patch");
});

test("consuming nothing is a no-op", () => {
  const context = createFakeRuntime();

  const rebuilt = repairOrganicCut(context.runtime, { consumedSurfaceKeys: [], paintedNodes: [] }, "cause-1");

  assert.equal(rebuilt, 0);
  assert.deepEqual(context.deleted, []);
  assert.deepEqual(context.addedPatches, []);
});

test("a face the engine refuses costs itself, never the rest of the mend", () => {
  const context = createFakeRuntime();
  context.reportLoops([holeAroundT1(TERRAIN_AROUND), holeAroundT1(TERRAIN_AROUND, "-second")]);
  context.refuseFirstSubmittedRegion();

  const rebuilt = repairOrganicCut(context.runtime, { consumedSurfaceKeys: [["@region", "T1"]], paintedNodes: [] }, "cause-1");

  assert.equal(rebuilt, 1, "the refused face costs only itself; the other still landed");
});

test("a region the engine no longer knows does not stop the others from being cut", () => {
  const context = createFakeRuntime();
  context.reportLoops([holeAroundT1(TERRAIN_AROUND)]);

  const rebuilt = repairOrganicCut(
    context.runtime,
    { consumedSurfaceKeys: [["@region", "T1"], ["@region", "gone"]], paintedNodes: [] },
    "cause-1",
  );

  assert.deepEqual(context.deleted, ["@region|T1"], "T1 still went, though the stale key threw");
  assert.equal(rebuilt, 1, "and the hole it left was still mended");
});
