import assert from "node:assert/strict";
import test from "node:test";

import { buildContourPatch, planSpineContour } from "../src/composition/tabletop/path/contour/spine-contour/index.ts";

const at = (x, z, y = 0) => ({ x, y, z });

/**
 * A standing region as this engine's own commit already names it:
 * `<opId>:band-<bandIndex>:<shapeIndex>`, a plain rectangular ring so a test
 * can hand-build one without going through a whole prior `planSpineContour`
 * call.
 */
function standingBand(opId, bandIndex, corners) {
  const nodes = corners.map((corner, index) => ({ id: `${opId}:n${index}`, position: corner }));
  const outerLoop = nodes.map((node, index) => ({
    edgeId: `${opId}-${index}`,
    reversed: false,
    startNodeId: node.id,
    endNodeId: nodes[(index + 1) % nodes.length].id,
    geometry: { kind: "line" },
  }));
  return {
    surfaceKey: ["@region", `${opId}:band-${bandIndex}:0`],
    surfaceType: "path",
    physical: true,
    outerLoops: [outerLoop],
    holes: [],
    nodes,
  };
}

test("a straight isolated run produces one region per band, each a clean quad, and consumes nothing standing", () => {
  const chain = {
    chainId: "run-1",
    controlPoints: [at(0, 0), at(10, 0)],
    bandOffsets: [-2.1, 0, 2.1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  const result = planSpineContour({
    tableId: "table",
    operationId: "op-1",
    surfaceType: "path",
    editedChains: [chain],
    standingRegions: [],
    existingNodes: [],
  });

  assert.ok(result !== undefined);
  assert.deepEqual(result.consumedSurfaceKeys, []);
  // Two bands (-2.1..0 and 0..2.1), no overlap between them, so no union
  // merges anything -- one region per band.
  assert.equal(result.patch.regions.length, 2);
  for (const region of result.patch.regions) {
    assert.equal(region.boundary.length, 4, "a straight run's band is a clean quad");
    assert.equal(region.holes, undefined, "no hole in an isolated band");
  }
});

test("a new road meeting a standing one in a T unions into one region and consumes the standing band", () => {
  const standing = standingBand("main", 0, [at(-5, -1), at(5, -1), at(5, 1), at(-5, 1)]);
  // Stops just inside the standing road's band (z: 1 -> -4), the way a T's
  // arriving road does -- its own ribbon overlaps the standing band rather
  // than merely touching it.
  const branch = {
    chainId: "branch",
    controlPoints: [at(0, 1), at(0, -4)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };

  const result = planSpineContour({
    tableId: "table",
    operationId: "op-t",
    surfaceType: "path",
    editedChains: [branch],
    standingRegions: [standing],
    existingNodes: standing.nodes,
  });

  assert.ok(result !== undefined);
  assert.deepEqual(result.consumedSurfaceKeys, [standing.surfaceKey]);
  // The standing band and the arriving ribbon share one band index and
  // overlap, so the union merges them into a single face -- no leftover rim
  // splitting the junction into two regions the way the old mouth/wedge
  // machinery had to special-case.
  assert.equal(result.patch.regions.length, 1, "a T merges into one face, not two");
});

test("a new road crossing a standing one in an X unions into one region", () => {
  const standing = standingBand("horizontal", 0, [at(-5, -1), at(5, -1), at(5, 1), at(-5, 1)]);
  const vertical = {
    chainId: "vertical",
    controlPoints: [at(0, -5), at(0, 5)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };

  const result = planSpineContour({
    tableId: "table",
    operationId: "op-x",
    surfaceType: "path",
    editedChains: [vertical],
    standingRegions: [standing],
    existingNodes: standing.nodes,
  });

  assert.ok(result !== undefined);
  assert.equal(result.patch.regions.length, 1, "an X merges into one face, not two overlapping ones");
  assert.deepEqual(result.consumedSurfaceKeys, [standing.surfaceKey]);
});

test("a sliver shape from a self-intersecting union never becomes a region", () => {
  // A real quad, plus a near-zero-area triangle -- the shape of artifact
  // `polygon-clipping` can leave behind when it normalises a self-
  // intersecting offset ribbon (a tight bend relative to the road's own
  // width). Every one of these is still a structurally valid ring, which
  // is exactly why area, not node count, is what has to catch it.
  const real = [[[0, 0], [10, 0], [10, 2], [0, 2], [0, 0]]];
  const sliver = [[[5, 1], [5.0001, 1], [5, 1.0001], [5, 1]]];
  const result = buildContourPatch("table", "op-sliver", "path", 0, [real, sliver], [], []);
  assert.equal(result.patch.regions.length, 1, "the sliver was filtered out before it became a region");
  assert.equal(result.regionIds.length, 1);
});

test("a local contour rebuild gives a full retained edge a private identity", () => {
  const nodes = [
    { id: "n0", position: at(0, 0) },
    { id: "n1", position: at(10, 0) },
    { id: "n2", position: at(10, 2) },
    { id: "n3", position: at(0, 2) },
  ];
  const shape = [[[0, 0], [10, 0], [10, 2], [0, 2], [0, 0]]];
  const fullEdge = "table:seg:n0~n1";
  const result = buildContourPatch(
    "table",
    "op-local",
    "path",
    0,
    [shape],
    [],
    nodes,
    new Map([[fullEdge, [false, true]]]),
  );

  assert.ok(
    result.patch.edges.some((edge) => edge.edgeId.startsWith("contour:op-local:band-0:seg:n0~n1")),
    "the rebuilt face does not claim a third use of the retained edge",
  );
});

test("two roads meeting end-to-end in an L stay one connected face, not two touching corners", () => {
  // A standing run ending at the origin, and a new run turning off it at a
  // right angle -- the shape an L reduces to once both are offset into
  // ribbons. Their bands overlap near the shared corner (the turn is sharp
  // relative to the width), which is exactly what used to need a hand-built
  // mitre; here it is just more area for the same union to cover.
  const standing = standingBand("main", 0, [at(-5, -1), at(0, -1), at(0, 1), at(-5, 1)]);
  const turn = {
    chainId: "turn",
    controlPoints: [at(0, 0), at(0, 5)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };

  const result = planSpineContour({
    tableId: "table",
    operationId: "op-l",
    surfaceType: "path",
    editedChains: [turn],
    standingRegions: [standing],
    existingNodes: standing.nodes,
  });

  assert.ok(result !== undefined);
  assert.equal(result.patch.regions.length, 1, "an L stays one connected face at the corner");
  assert.deepEqual(result.consumedSurfaceKeys, [standing.surfaceKey]);
});

test("a spine edit does not consume a merely nearby standing band", () => {
  const nearby = standingBand("nearby", 0, [at(11, -1), at(20, -1), at(20, 1), at(11, 1)]);
  const faraway = standingBand("faraway", 0, [at(1000, -1), at(1010, -1), at(1010, 1), at(1000, 1)]);
  const edited = {
    chainId: "edited",
    controlPoints: [at(0, 0), at(10, 0)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };

  const result = planSpineContour({
    tableId: "table",
    operationId: "op-dirty",
    surfaceType: "path",
    editedChains: [edited],
    standingRegions: [nearby, faraway],
    existingNodes: [...nearby.nodes, ...faraway.nodes],
  });

  assert.ok(result !== undefined);
  const consumedIds = result.consumedSurfaceKeys.map((key) => key.join(":"));
  assert.ok(!consumedIds.includes(nearby.surfaceKey.join(":")), "a bounding-box touch is not a contour intersection");
  assert.ok(!consumedIds.includes(faraway.surfaceKey.join(":")), "a band far outside reach is left alone");
  // The untouched band's own nodes never appear in the new patch at all.
  const patchNodeIds = new Set(result.patch.nodes.map((node) => node.id));
  for (const node of faraway.nodes) assert.ok(!patchNodeIds.has(node.id));
});

/** A `ConstructionRegionTopology` reconstructed from one region of a patch this engine already produced -- what a real session would report back on the next read. */
function topologyFromPatchRegion(patch, region) {
  const edgeById = new Map(patch.edges.map((edge) => [edge.edgeId, edge]));
  const positionById = new Map(patch.nodes.map((node) => [node.id, node.position]));
  const outerLoop = region.boundary.map((use) => {
    const edge = edgeById.get(use.edgeId);
    const startNodeId = use.reversed ? edge.endNodeId : edge.startNodeId;
    const endNodeId = use.reversed ? edge.startNodeId : edge.endNodeId;
    return { edgeId: use.edgeId, reversed: use.reversed, startNodeId, endNodeId, geometry: edge.geometry ?? { kind: "line" } };
  });
  const nodes = outerLoop.map((use) => ({ id: use.startNodeId, position: positionById.get(use.startNodeId) }));
  return {
    surfaceKey: ["@region", region.regionId],
    surfaceType: region.surfaceType,
    physical: region.physical,
    outerLoops: [outerLoop],
    holes: [],
    nodes,
  };
}

test("a standing band with no ribbon overlap is never re-consumed", () => {
  const chain = {
    chainId: "run-1",
    controlPoints: [at(0, 0), at(10, 0)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  const first = planSpineContour({
    tableId: "table",
    operationId: "op-1",
    surfaceType: "path",
    editedChains: [chain],
    standingRegions: [],
    existingNodes: [],
  });
  assert.ok(first !== undefined);

  // This nearby stroke's ribbon never touches the standing band's. The
  // bounding-box broad phase admits it, but the exact footprint phase must
  // leave it out of the replacement completely.
  const nudge = {
    chainId: "nudge",
    controlPoints: [at(9, 3), at(9, 1.5)],
    bandOffsets: [-1, 1],
    miterLimit: 4,
    tolerance: 0.05,
  };
  const bandZeroRegion = first.patch.regions.find((region) => region.regionId.includes(":band-0:"));
  const standingTopology = topologyFromPatchRegion(first.patch, bandZeroRegion);

  const second = planSpineContour({
    tableId: "table",
    operationId: "op-2",
    surfaceType: "path",
    editedChains: [nudge],
    standingRegions: [standingTopology],
    existingNodes: first.patch.nodes,
  });
  assert.ok(second !== undefined);

  assert.deepEqual(second.consumedSurfaceKeys, [], "a non-overlapping band is not a replacement source");
  assert.ok(
    !second.patch.nodes.some((node) => node.id.startsWith("contour:op-1:band-0:")),
    "the standing band's nodes are not re-emitted into the new patch",
  );
});

test("a standing region touched only through another standing region is still consumed, whatever order they arrive in", () => {
  // The edited chain (x in [-2, 2], z in [-5, 5]) overlaps band A directly
  // (z 4..6). Band B (z 6..7) sits past the chain's own z-end, inside the
  // grown dirty region only because of the reach margin, and only touches A
  // -- never the chain's own ribbon. Handed to planSpineContour as [B, A]
  // (B before the thing it touches): a single pass that only checks each
  // candidate against ribbons collected *so far* would consume A (touches
  // the chain) but miss B, since at the moment B is checked, A is not yet in
  // the list. The union would then leave B standing while A's own new face
  // is welded right up against it, and the whole replacement gets refused
  // by the runtime for the overlap -- this is the "faces disappear when
  // roads join" failure mode.
  const bandA = standingBand("chain-a", 0, [at(-2, 4), at(2, 4), at(2, 6), at(-2, 6)]);
  const bandB = standingBand("chain-b", 0, [at(-2, 6), at(2, 6), at(2, 7), at(-2, 7)]);
  const chain = {
    chainId: "through-a",
    controlPoints: [at(0, -5), at(0, 5)],
    bandOffsets: [-2, 2],
    miterLimit: 4,
    tolerance: 0.05,
  };

  const result = planSpineContour({
    tableId: "table",
    operationId: "op-chain",
    surfaceType: "path",
    editedChains: [chain],
    standingRegions: [bandB, bandA],
    existingNodes: [...bandA.nodes, ...bandB.nodes],
  });

  assert.ok(result !== undefined);
  const consumedKeys = new Set(result.consumedSurfaceKeys.map((key) => key.join(":")));
  for (const band of [bandA, bandB]) {
    assert.ok(consumedKeys.has(band.surfaceKey.join(":")), `${band.surfaceKey.join(":")} must be consumed`);
  }
  assert.equal(result.patch.regions.length, 1, "the whole chain unions into one face, not a mix of new and stale ones");
});
