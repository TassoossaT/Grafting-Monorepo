import assert from "node:assert/strict";
import test from "node:test";

import { findWallSurfaceAt, resolveWallCrossing } from "../src/composition/tabletop/tools/walls/wall-shared.ts";
import { panelTopology } from "./wall-spans-fixture.mjs";

const TABLE_ID = "table-1";
const WALL = panelTopology("wall-1", { from: { x: 0, z: 0 }, to: { x: 4, z: 0 } });

function contextFor(topologies) {
  const weldCalls = [];
  return {
    ctx: {
      runtime: {
        getAllRegionTopologies: () => topologies,
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
    },
    weldCalls,
  };
}

test("a point on the middle of a wall's centerline welds into it and snaps onto the weld", () => {
  const { ctx, weldCalls } = contextFor([WALL]);

  const resolved = resolveWallCrossing(ctx, { x: 2, y: 5, z: 0 }, "cause-1");

  assert.deepEqual(resolved, { x: 2, y: 0, z: 0 }, "snaps to the existing wall's own baseline Y, not the raw point's");
  assert.equal(weldCalls.length, 1);

  const [call] = weldCalls;
  assert.equal(call.causeId, "cause-1");
  const idPrefix = `${TABLE_ID}:wall-brush`;
  const bottomId = `${idPrefix}:corner:2.000:0.000:bottom`;
  const topId = `${idPrefix}:corner:2.000:0.000:top`;

  assert.equal(call.inserts.length, 2, "the bottom run and the top run each gain a vertex");
  assert.deepEqual(
    call.inserts.map((insert) => ({ edgeId: insert.edgeId, nodeId: insert.nodeId, position: insert.position })),
    [
      { edgeId: "wall-1-0", nodeId: bottomId, position: { x: 2, y: 0, z: 0 } },
      { edgeId: "wall-1-2", nodeId: topId, position: { x: 2, y: 3, z: 0 } },
    ],
  );
  for (const insert of call.inserts) {
    assert.ok(insert.firstEdgeId.startsWith(insert.edgeId), "fragment ids stay derived from the edge they replace");
    assert.notEqual(insert.firstEdgeId, insert.secondEdgeId);
  }
});

test("a point too far off the wall's centerline is left alone", () => {
  const { ctx, weldCalls } = contextFor([WALL]);

  const resolved = resolveWallCrossing(ctx, { x: 2, y: 0, z: 1 }, "cause-1");

  assert.deepEqual(resolved, { x: 2, y: 0, z: 1 });
  assert.equal(weldCalls.length, 0);
});

test("a point near an existing corner is left alone -- ordinary position-weld already handles it", () => {
  const { ctx, weldCalls } = contextFor([WALL]);

  const resolved = resolveWallCrossing(ctx, { x: 0.05, y: 0, z: 0 }, "cause-1");

  assert.deepEqual(resolved, { x: 0.05, y: 0, z: 0 });
  assert.equal(weldCalls.length, 0);
});

test("a point with no wall panels on the table is left alone", () => {
  const { ctx, weldCalls } = contextFor([]);

  const resolved = resolveWallCrossing(ctx, { x: 2, y: 0, z: 0 }, "cause-1");

  assert.deepEqual(resolved, { x: 2, y: 0, z: 0 });
  assert.equal(weldCalls.length, 0);
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
