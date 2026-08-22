import assert from "node:assert/strict";
import test from "node:test";

import {
  commitWallContour,
  commitWallStroke,
  findWallSurfaceAt,
} from "../src/composition/tabletop/tools/walls/wall-shared.ts";
import { panelTopology } from "./wall-spans-fixture.mjs";

const TABLE_ID = "table-1";
const PARAMS = { wallType: "wall-white", height: 3 };
const WALL = panelTopology("wall-1", { from: { x: 0, z: 0 }, to: { x: 4, z: 0 } });

/**
 * Shared by every context in this file, the way the real runtime's own
 * counter is shared by every gesture on a table. Two contexts with private
 * counters would mint the same node ids for two different runs, which is a
 * property of the fixture, never of the code under test.
 */
let sequence = 0;

function contextFor(topologies, snapToGrid = false) {
  const weldCalls = [];
  const patches = [];
  return {
    ctx: {
      runtime: {
        getAllRegionTopologies: () => topologies,
        addPatch: (patch, origin, causeId) => {
          patches.push({ patch, origin, causeId });
          return {
            affectedSurfaceKeys: [],
            createdSurfaceKeys: [],
            removedSurfaceKeys: [],
            createdNodeIds: [],
            removedNodeIds: [],
            skippedRegionIds: [],
          };
        },
        applyWallCrossingWeld: (inserts, origin, causeId) => {
          weldCalls.push({ inserts, origin, causeId });
          return {
            affectedSurfaceKeys: [],
            createdSurfaceKeys: [],
            removedSurfaceKeys: [],
            createdNodeIds: [],
            removedNodeIds: [],
          };
        },
      },
      history: undefined,
      tableId: TABLE_ID,
      snapToGrid,
      nextSequence: () => (sequence += 1),
      reportSelection: () => {},
      reportFeedback: () => {},
    },
    weldCalls,
    patches,
  };
}

function line(start, end) {
  return { start, end, geometry: { kind: "line" } };
}

/** A declared edge's geometry, with absent meaning the straight chord it stands for. */
function geometryOf(edge) {
  return edge.geometry ?? { kind: "line" };
}

/**
 * Turns a patch back into the region topologies the engine would report for
 * it, so a second run can be committed against what a first one actually
 * built -- the only way to reproduce two runs meeting on one column.
 */
function topologiesFrom(patch) {
  const edgeById = new Map(patch.edges.map((edge) => [edge.edgeId, edge]));
  const positionById = new Map(patch.nodes.map((node) => [node.id, node.position]));
  return patch.regions.map((region) => {
    const loop = region.boundary.map((use) => {
      const edge = edgeById.get(use.edgeId);
      return {
        edgeId: use.edgeId,
        reversed: use.reversed,
        startNodeId: edge.startNodeId,
        endNodeId: edge.endNodeId,
        geometry: edge.geometry ?? { kind: "line" },
      };
    });
    const ids = [...new Set(loop.flatMap((edge) => [edge.startNodeId, edge.endNodeId]))];
    return {
      surfaceKey: ["@region", region.regionId],
      surfaceType: region.surfaceType,
      physical: region.physical,
      outerLoops: [loop],
      holes: [],
      nodes: ids.map((id) => ({ id, position: positionById.get(id) })),
    };
  });
}

/** The edge use a panel walks along `column`'s own vertical, by the node ids of that column. */
function verticalUse(patch, bottomNodeId, topNodeId) {
  const edgeById = new Map(patch.edges.map((edge) => [edge.edgeId, edge]));
  return patch.regions
    .flatMap((region) => region.boundary)
    .find((use) => {
      const edge = edgeById.get(use.edgeId);
      const ends = [edge.startNodeId, edge.endNodeId];
      return ends.includes(bottomNodeId) && ends.includes(topNodeId);
    });
}

test("a run on empty ground mints its own columns and declares one panel per step", () => {
  const { ctx, patches, weldCalls } = contextFor([]);

  commitWallContour(
    ctx,
    [line({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }), line({ x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 4 })],
    PARAMS,
    "wall-line",
  );

  assert.equal(weldCalls.length, 0);
  assert.equal(patches.length, 1);
  const { patch } = patches[0];
  assert.equal(patch.regions.length, 2, "two steps, two panels");
  assert.equal(patch.nodes.length, 6, "three columns, bottom and top each");
  for (const node of patch.nodes) assert.ok(node.id.startsWith(`${TABLE_ID}:wall-`), "fresh ids are namespaced by the run, never derived from the coordinate");
  const tops = patch.nodes.filter((node) => node.position.y === 3);
  assert.equal(tops.length, 3, "height is the length of each column's own vertical edge");
});

test("two panels meeting at a corner reference one shared vertical edge, used twice", () => {
  const { ctx, patches } = contextFor([]);

  commitWallContour(
    ctx,
    [line({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }), line({ x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 4 })],
    PARAMS,
    "wall-line",
  );

  const { patch } = patches[0];
  const uses = patch.regions.flatMap((region) => region.boundary.map((use) => use.edgeId));
  const shared = [...new Set(uses)].filter((edgeId) => uses.filter((candidate) => candidate === edgeId).length === 2);
  assert.equal(shared.length, 1, "exactly the vertical the two panels meet along");
  const [sharedEdgeId] = shared;
  const directions = patch.regions
    .flatMap((region) => region.boundary)
    .filter((use) => use.edgeId === sharedEdgeId)
    .map((use) => use.reversed);
  assert.deepEqual([...directions].sort(), [false, true], "one face on each side, which is what makes it shared rather than coincident");
});

test("each panel is declared base, column, top, column -- the two verticals opposite each other", () => {
  const { ctx, patches } = contextFor([]);

  commitWallContour(ctx, [line({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })], PARAMS, "wall-line");

  const { patch } = patches[0];
  const edgeById = new Map(patch.edges.map((edge) => [edge.edgeId, edge]));
  const positionById = new Map(patch.nodes.map((node) => [node.id, node.position]));
  const isVertical = (use) => {
    const edge = edgeById.get(use.edgeId);
    const start = positionById.get(edge.startNodeId);
    const end = positionById.get(edge.endNodeId);
    return start.x === end.x && start.z === end.z && start.y !== end.y;
  };
  const boundary = patch.regions[0].boundary;
  assert.deepEqual(boundary.map(isVertical), [false, true, false, true]);
});

test("a curved step carries its arc on the boundary edge, mirrored on the top rail", () => {
  const { ctx, patches } = contextFor([]);
  const arc = { kind: "arc", center: [2, 0], clockwise: true };

  commitWallContour(
    ctx,
    [{ start: { x: 0, y: 0, z: 0 }, end: { x: 4, y: 0, z: 0 }, geometry: arc }],
    PARAMS,
    "wall-brush",
  );

  const { patch } = patches[0];
  const arcs = patch.edges.filter((edge) => geometryOf(edge).kind === "arc");
  assert.equal(arcs.length, 2, "the base and the top rail, both curved -- verticals stay straight");
  for (const edge of arcs) assert.deepEqual(geometryOf(edge).center, [2, 0]);
  // Both rails are stored bottom-column-first, so both sweep the same way:
  // the top rail is walked backwards *by the face*, and reversing a use is
  // what flips the sweep, not storing a second, opposite curve.
  for (const edge of arcs) assert.equal(geometryOf(edge).clockwise, true);
});

test("a corner landing on an existing panel's corner uses that panel's own nodes", () => {
  const { ctx, patches, weldCalls } = contextFor([WALL]);

  commitWallContour(ctx, [line({ x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 4 })], PARAMS, "wall-line");

  assert.equal(weldCalls.length, 0, "landing on a corner connects to it, it does not split anything");
  const { patch } = patches[0];
  const ids = patch.nodes.map((node) => node.id);
  assert.ok(ids.includes("wall-1:b-bottom"), "welding is referencing the very node, never minting a second one at the same place");
  assert.ok(ids.includes("wall-1:b-top"));
});

test("a corner landing on the side of an existing panel inserts a column into it and connects there", () => {
  const { ctx, patches, weldCalls } = contextFor([WALL]);

  commitWallContour(ctx, [line({ x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 4 })], PARAMS, "wall-line");

  assert.equal(weldCalls.length, 1);
  const [call] = weldCalls;
  assert.equal(call.inserts.length, 2, "the bottom run and the top run each gain a vertex");
  assert.deepEqual(call.inserts.map((insert) => insert.edgeId), ["wall-1-0", "wall-1-2"]);
  assert.deepEqual(call.inserts.map((insert) => insert.position), [
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 3, z: 0 },
  ]);
  for (const insert of call.inserts) {
    assert.ok(insert.firstEdgeId.startsWith(insert.edgeId), "fragment ids stay derived from the edge they replace");
    assert.notEqual(insert.firstEdgeId, insert.secondEdgeId);
  }

  const ids = patches[0].patch.nodes.map((node) => node.id);
  for (const insert of call.inserts) assert.ok(ids.includes(insert.nodeId), "the new run is built on the inserted nodes themselves");
});

test("a corner well clear of every panel connects to nothing", () => {
  const { ctx, patches, weldCalls } = contextFor([WALL]);

  commitWallContour(ctx, [line({ x: 2, y: 0, z: 5 }, { x: 6, y: 0, z: 5 })], PARAMS, "wall-line");

  assert.equal(weldCalls.length, 0);
  for (const node of patches[0].patch.nodes) assert.ok(node.id.startsWith(`${TABLE_ID}:wall-`));
});

test("a stroke that comes back to where it started closes, with no seam column", () => {
  const { ctx, patches } = contextFor([]);
  const square = [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 4, y: 0, z: 4 },
    { x: 0, y: 0, z: 4 },
    { x: 0, y: 0, z: 0 },
  ];

  commitWallStroke(ctx, square, 0.4, PARAMS, "wall-brush");

  const { patch } = patches[0];
  assert.equal(patch.regions.length, 4, "four sides, four panels, and the last one closes onto the first column");
  assert.equal(patch.nodes.length, 8, "four columns -- the closing corner is not a fifth");
});

test("a stroke commits nothing when it never moved", () => {
  const { ctx, patches } = contextFor([]);
  commitWallStroke(ctx, [{ x: 1, y: 0, z: 1 }], 0.4, PARAMS, "wall-brush");
  assert.equal(patches.length, 0);
});

/**
 * Drawing a run *into* the far end of an existing wall used to declare a
 * panel bounded by that column's vertical walked the same way the existing
 * panel already walks it. An edge bounds two faces, one per side, so the
 * engine refused the whole face and reported it as skipped -- silently, as
 * far as the drawing went. Joining two separate walls therefore worked in
 * one direction and did nothing in the other.
 */
test("a run ending on an existing wall's far column still declares its panel", () => {
  const built = contextFor([]);
  commitWallContour(built.ctx, [line({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })], PARAMS, "wall-line");
  const wallA = built.patches[0].patch;
  const farColumn = wallA.nodes.filter((node) => node.position.x === 4);
  const [farBottom, farTop] = [
    farColumn.find((node) => node.position.y === 0).id,
    farColumn.find((node) => node.position.y === 3).id,
  ];

  const linking = contextFor(topologiesFrom(wallA));
  commitWallContour(
    linking.ctx,
    [line({ x: 4, y: 0, z: 4 }, { x: 4, y: 0, z: 0 })],
    PARAMS,
    "wall-line",
  );

  assert.equal(linking.patches.length, 1);
  const { patch } = linking.patches[0];
  assert.equal(patch.regions.length, 1, "the linking panel must be declared, not refused");
  const ids = patch.nodes.map((node) => node.id);
  assert.ok(ids.includes(farBottom), "the run is built on the existing column's own nodes");
  assert.ok(ids.includes(farTop));

  const shared = verticalUse(wallA, farBottom, farTop);
  const claimed = verticalUse(patch, farBottom, farTop);
  assert.notEqual(
    claimed.edgeId,
    shared.edgeId,
    "with no room on the shared edge the run keeps its own over the same nodes -- the column is what joins them",
  );
});

test("a run leaving an existing wall's far column shares that column's own edge", () => {
  const built = contextFor([]);
  commitWallContour(built.ctx, [line({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })], PARAMS, "wall-line");
  const wallA = built.patches[0].patch;
  const farColumn = wallA.nodes.filter((node) => node.position.x === 4);
  const [farBottom, farTop] = [
    farColumn.find((node) => node.position.y === 0).id,
    farColumn.find((node) => node.position.y === 3).id,
  ];

  const linking = contextFor(topologiesFrom(wallA));
  commitWallContour(
    linking.ctx,
    [line({ x: 4, y: 0, z: 0 }, { x: 4, y: 0, z: 4 })],
    PARAMS,
    "wall-line",
  );

  const { patch } = linking.patches[0];
  assert.equal(patch.regions.length, 1);
  assert.equal(
    verticalUse(patch, farBottom, farTop).edgeId,
    verticalUse(wallA, farBottom, farTop).edgeId,
    "where the edge has room the two panels still meet along one edge",
  );
});

test("three panels may meet at one column", () => {
  const built = contextFor([]);
  commitWallContour(built.ctx, [line({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 })], PARAMS, "wall-line");
  let topologies = topologiesFrom(built.patches[0].patch);

  for (const target of [{ x: 4, y: 0, z: 4 }, { x: 4, y: 0, z: -4 }, { x: 8, y: 0, z: 0 }]) {
    const run = contextFor(topologies);
    commitWallContour(run.ctx, [line({ x: 4, y: 0, z: 0 }, target)], PARAMS, "wall-line");
    assert.equal(run.patches[0].patch.regions.length, 1, `a panel toward ${target.z} must be declared`);
    topologies = [...topologies, ...topologiesFrom(run.patches[0].patch)];
  }
  assert.equal(topologies.length, 4, "four panels now meet at that column");
});

test("with the grid magnet on, a staircase of snapped samples commits only straight runs", () => {
  const { ctx, patches } = contextFor([], true);
  // Exactly what the dispatcher hands over once every ground point is
  // rounded to an intersection: a staircase, whose every three points sit
  // on some circle nobody drew.
  const staircase = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
    { x: 2, y: 0, z: 2 },
    { x: 3, y: 0, z: 2 },
  ];

  commitWallStroke(ctx, staircase, 0.3, PARAMS, "wall-brush");

  const { patch } = patches[0];
  for (const edge of patch.edges) {
    assert.equal(geometryOf(edge).kind, "line", "a snapped stroke has no hand in it to read curvature out of");
  }
});

test("repeated samples on one intersection do not become a panel of no width", () => {
  const { ctx, patches } = contextFor([], true);
  const held = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
  ];

  commitWallStroke(ctx, held, 0.3, PARAMS, "wall-brush");

  const { patch } = patches[0];
  assert.equal(patch.regions.length, 1);
  assert.equal(patch.nodes.length, 4, "two columns, not one per repeated sample");
});

test("findWallSurfaceAt returns the panel a point lands directly on, even near its own corner", () => {
  const { ctx } = contextFor([WALL]);

  assert.deepEqual(findWallSurfaceAt(ctx, { x: 2, y: 1.5, z: 0 }), ["@region", "wall-1"]);
  assert.deepEqual(findWallSurfaceAt(ctx, { x: 0.05, y: 0, z: 0 }), ["@region", "wall-1"]);
});

test("findWallSurfaceAt returns undefined for a point off every wall's centerline", () => {
  const { ctx } = contextFor([WALL]);

  assert.equal(findWallSurfaceAt(ctx, { x: 2, y: 0, z: 5 }), undefined);
});

test("findWallSurfaceAt picks the closest panel when more than one qualifies", () => {
  const nearer = panelTopology("wall-2", { from: { x: 0, z: 0.1 }, to: { x: 4, z: 0.1 } });
  const { ctx } = contextFor([WALL, nearer]);

  assert.deepEqual(findWallSurfaceAt(ctx, { x: 2, y: 0, z: 0.06 }), ["@region", "wall-2"]);
});
