import assert from "node:assert/strict";
import test from "node:test";

import { resolveWallCrossing } from "../src/composition/tabletop/tools/wall-shared.ts";

const TABLE_ID = "table-1";

/** One 4-node wall panel from (0,0,0) to (4,0,0), height 3, matching `extrude_path`'s own `[bottomA, bottomB, topB, topA]` cycle convention. */
function wallMap() {
  const surface = {
    surfaceRef: "wall-1",
    orderedNodeRefs: ["w:a-bottom", "w:b-bottom", "w:b-top", "w:a-top"],
    type: "wall-white",
    physical: true,
    revision: 1,
  };
  const nodePositions = new Map([
    ["w:a-bottom", { nodeRef: "w:a-bottom", position: { x: 0, y: 0, z: 0 }, revision: 1 }],
    ["w:a-top", { nodeRef: "w:a-top", position: { x: 0, y: 3, z: 0 }, revision: 1 }],
    ["w:b-bottom", { nodeRef: "w:b-bottom", position: { x: 4, y: 0, z: 0 }, revision: 1 }],
    ["w:b-top", { nodeRef: "w:b-top", position: { x: 4, y: 3, z: 0 }, revision: 1 }],
  ]);
  return { byId: new Map([["wall-1", surface]]), nodePositions, revision: 1 };
}

function contextFor(map) {
  const splitCalls = [];
  return {
    ctx: {
      runtime: {
        getSnapshot: () => ({ map }),
        applyWallCrossingSplit: (nodes, splits, origin, causeId) => {
          splitCalls.push({ nodes, splits, origin, causeId });
          return [];
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
    splitCalls,
  };
}

test("a point on the middle of a wall's centerline splits it and snaps onto the split", () => {
  const { ctx, splitCalls } = contextFor(wallMap());

  const resolved = resolveWallCrossing(ctx, { x: 2, y: 5, z: 0 }, "cause-1");

  assert.deepEqual(resolved, { x: 2, y: 0, z: 0 }, "snaps to the existing wall's own baseline Y, not the raw point's");
  assert.equal(splitCalls.length, 1);

  const [call] = splitCalls;
  assert.equal(call.causeId, "cause-1");
  const idPrefix = `${TABLE_ID}:wall-brush`;
  const bottomId = `${idPrefix}:corner:2.000:0.000:bottom`;
  const topId = `${idPrefix}:corner:2.000:0.000:top`;

  assert.deepEqual(
    call.nodes,
    [
      { id: bottomId, position: { x: 2, y: 0, z: 0 } },
      { id: topId, position: { x: 2, y: 3, z: 0 } },
    ],
  );
  assert.equal(call.splits.length, 1);
  assert.deepEqual(call.splits[0], {
    originalKey: ["w:a-bottom", "w:b-bottom", "w:b-top", "w:a-top"],
    first: { cycle: ["w:a-bottom", bottomId, topId, "w:a-top"], surfaceType: "wall-white", physical: true },
    second: { cycle: [bottomId, "w:b-bottom", "w:b-top", topId], surfaceType: "wall-white", physical: true },
  });
});

test("a point too far off the wall's centerline is left alone", () => {
  const { ctx, splitCalls } = contextFor(wallMap());

  const resolved = resolveWallCrossing(ctx, { x: 2, y: 0, z: 1 }, "cause-1");

  assert.deepEqual(resolved, { x: 2, y: 0, z: 1 });
  assert.equal(splitCalls.length, 0);
});

test("a point near an existing corner is left alone -- ordinary position-weld already handles it", () => {
  const { ctx, splitCalls } = contextFor(wallMap());

  const resolved = resolveWallCrossing(ctx, { x: 0.05, y: 0, z: 0 }, "cause-1");

  assert.deepEqual(resolved, { x: 0.05, y: 0, z: 0 });
  assert.equal(splitCalls.length, 0);
});

test("a point with no wall panels on the table is left alone", () => {
  const { ctx, splitCalls } = contextFor({ byId: new Map(), nodePositions: new Map(), revision: 0 });

  const resolved = resolveWallCrossing(ctx, { x: 2, y: 0, z: 0 }, "cause-1");

  assert.deepEqual(resolved, { x: 2, y: 0, z: 0 });
  assert.equal(splitCalls.length, 0);
});
