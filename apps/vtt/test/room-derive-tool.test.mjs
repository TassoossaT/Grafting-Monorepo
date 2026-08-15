import assert from "node:assert/strict";
import test from "node:test";

import { createMapProjection } from "../src/entities/map/index.ts";
import { roomDeriveTool } from "../src/composition/tabletop/tools/room-derive-tool.ts";

const WALL_HEIGHT = 3;

/** A closed 4-wall square (0,0)-(4,0)-(4,4)-(0,4), corners shared between adjacent walls -- exactly what wall-brush's own corner weld produces for a hand-drawn room. */
function squareRoomMap() {
  const corners = {
    a: { x: 0, z: 0 },
    b: { x: 4, z: 0 },
    c: { x: 4, z: 4 },
    d: { x: 0, z: 4 },
  };
  const nodePositions = [];
  for (const [id, point] of Object.entries(corners)) {
    nodePositions.push({ nodeRef: `${id}-bottom`, position: { x: point.x, y: 0, z: point.z }, revision: 0 });
    nodePositions.push({ nodeRef: `${id}-top`, position: { x: point.x, y: WALL_HEIGHT, z: point.z }, revision: 0 });
  }

  const wall = (from, to) => ({
    surfaceRef: `${from}-${to}`,
    orderedNodeRefs: [`${from}-bottom`, `${to}-bottom`, `${to}-top`, `${from}-top`],
    type: "wall-white",
    physical: true,
    revision: 0,
  });
  const surfaces = [wall("a", "b"), wall("b", "c"), wall("c", "d"), wall("d", "a")];

  return createMapProjection(surfaces, nodePositions);
}

function fakeContext(map) {
  const submitted = [];
  return {
    context: {
      tableId: "table-1",
      nextSequence: (() => {
        let n = 0;
        return () => (n += 1);
      })(),
      runtime: {
        getSnapshot: () => ({ map }),
        applyIrregularTerrainPatch: (nodes, surfaces, origin, causeId) => {
          submitted.push({ nodes, surfaces, origin, causeId });
          return [];
        },
      },
    },
    submitted,
  };
}

test("clicking inside a closed 4-wall square derives a floor and ceiling over its 4 corners", () => {
  const { context, submitted } = fakeContext(squareRoomMap());

  roomDeriveTool.onClick(context, { point: { x: 2, y: 0, z: 2 } }, {});

  assert.equal(submitted.length, 1);
  const [{ nodes, surfaces }] = submitted;
  assert.deepEqual(nodes, []);
  assert.equal(surfaces.length, 2);

  const floor = surfaces.find((surface) => surface.surfaceType === "floor");
  const ceiling = surfaces.find((surface) => surface.surfaceType === "ceiling");
  assert.ok(floor, "expected a floor surface");
  assert.ok(ceiling, "expected a ceiling surface");
  assert.equal(floor.physical, true);
  assert.equal(ceiling.physical, true);

  assert.deepEqual(new Set(floor.cycle), new Set(["a-bottom", "b-bottom", "c-bottom", "d-bottom"]));
  assert.deepEqual(new Set(ceiling.cycle), new Set(["a-top", "b-top", "c-top", "d-top"]));
});

test("clicking outside every closed wall loop derives nothing", () => {
  const { context, submitted } = fakeContext(squareRoomMap());

  roomDeriveTool.onClick(context, { point: { x: 20, y: 0, z: 20 } }, {});

  assert.equal(submitted.length, 0);
});

test("an open (unclosed) chain of walls never derives a room, however close the click", () => {
  const map = squareRoomMap();
  // Drop the 4th wall (d -> a) so the loop never closes.
  const openSurfaces = [...map.byId.values()].slice(0, 3);
  const openMap = createMapProjection(openSurfaces, [...map.nodePositions.values()]);
  const { context, submitted } = fakeContext(openMap);

  roomDeriveTool.onClick(context, { point: { x: 2, y: 0, z: 2 } }, {});

  assert.equal(submitted.length, 0);
});
