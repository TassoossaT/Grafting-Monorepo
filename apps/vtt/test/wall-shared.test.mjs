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

function contextFor(topologies) {
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
      nextSequence: (() => {
        let n = 0;
        return () => ++n;
      })(),
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
  const arcs = patch.edges.filter((edge) => edge.geometry.kind === "arc");
  assert.equal(arcs.length, 2, "the base and the top rail, both curved -- verticals stay straight");
  for (const edge of arcs) assert.deepEqual(edge.geometry.center, [2, 0]);
  // Both rails are stored bottom-column-first, so both sweep the same way:
  // the top rail is walked backwards *by the face*, and reversing a use is
  // what flips the sweep, not storing a second, opposite curve.
  for (const edge of arcs) assert.equal(edge.geometry.clockwise, true);
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
