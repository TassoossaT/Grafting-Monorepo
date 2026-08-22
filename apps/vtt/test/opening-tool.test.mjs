import assert from "node:assert/strict";
import test from "node:test";

import { panelRailOf } from "../src/composition/tabletop/tools/openings/panel-rail.ts";
import { openingTool } from "../src/composition/tabletop/tools/openings/opening-tool.ts";

const TABLE_ID = "table-1";
const WINDOW = { openingType: "window", width: 1, height: 1, sill: 1 };

let sequence = 0;

/**
 * One upright panel as the engine reports it: a base run, a side rising, a
 * run back along the top, a side coming down. `arc` swaps the rails'
 * geometry and nothing else.
 */
function panelTopology(id, corners, arc) {
  const nodes = [
    { id: `${id}:b0`, position: { ...corners.from, y: 0 } },
    { id: `${id}:b1`, position: { ...corners.to, y: 0 } },
    { id: `${id}:t1`, position: { ...corners.to, y: 3 } },
    { id: `${id}:t0`, position: { ...corners.from, y: 3 } },
  ];
  const rail = (clockwise) => (arc === undefined ? { kind: "line" } : { kind: "arc", center: arc, clockwise });
  const steps = [
    [0, 1, rail(false)],
    [1, 2, { kind: "line" }],
    [2, 3, rail(true)],
    [3, 0, { kind: "line" }],
  ];
  return {
    surfaceKey: ["@region", id],
    surfaceType: "wall-white",
    physical: true,
    outerLoops: [
      steps.map(([from, to, geometry], index) => ({
        edgeId: `${id}-${index}`,
        reversed: false,
        startNodeId: nodes[from].id,
        endNodeId: nodes[to].id,
        geometry,
      })),
    ],
    holes: [],
    nodes,
  };
}

function contextFor(topologies) {
  const patches = [];
  const holes = [];
  return {
    patches,
    holes,
    ctx: {
      runtime: {
        getAllRegionTopologies: () => topologies,
        getRegionTopology: (surfaceKey) =>
          topologies.find((topology) => topology.surfaceKey.join("|") === surfaceKey.join("|")),
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
        addHole: (request, origin, causeId) => {
          holes.push({ request, origin, causeId });
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
      snapToGrid: false,
      nextSequence: () => (sequence += 1),
      reportSelection: () => {},
      reportFeedback: () => {},
    },
  };
}

const STRAIGHT = panelTopology("wall-1", { from: { x: 0, z: 0 }, to: { x: 6, z: 0 } });
// Half of a radius-2 circle centred on the origin, three units tall.
const CURVED = panelTopology("wall-arc", { from: { x: 2, z: 0 }, to: { x: -2, z: 0 } }, [0, 0]);

test("a straight panel reads as a rail of its own length", () => {
  const rail = panelRailOf(STRAIGHT);
  assert.ok(Math.abs(rail.length - 6) < 1e-6);
  assert.equal(rail.baseY, 0);
  assert.equal(rail.topY, 3);
  assert.deepEqual(rail.positionAt(2, 1), { x: 2, y: 1, z: 0 });
  assert.ok(Math.abs(rail.travelTo({ x: 4.5, y: 0, z: 0 }) - 4.5) < 1e-6);
});

test("a curved panel is travelled, not spanned", () => {
  const rail = panelRailOf(CURVED);
  assert.ok(
    Math.abs(rail.length - Math.PI * 2) < 1e-4,
    `half a radius-2 circle is PI*2 long, got ${rail.length}`,
  );
  // Halfway along the rail is the far side of the arc, not the midpoint of
  // the chord between its ends -- which is the origin, and is nowhere on it.
  const middle = rail.positionAt(rail.length / 2, 1);
  assert.ok(Math.abs(Math.hypot(middle.x, middle.z) - 2) < 1e-4, "stays on the true circle");
  assert.ok(Math.abs(middle.x) < 1e-4 && Math.abs(middle.z - 2) < 1e-4);
});

test("every point placed on a curved panel stays on its cylinder", () => {
  const rail = panelRailOf(CURVED);
  for (let step = 0; step <= 10; step += 1) {
    const point = rail.positionAt((rail.length * step) / 10, 1.5);
    assert.ok(Math.abs(Math.hypot(point.x, point.z) - 2) < 1e-4, `left the cylinder at ${step}`);
    assert.equal(point.y, 1.5);
  }
});

test("a flat face is not a panel and takes no opening", () => {
  const flat = {
    surfaceKey: ["@region", "floor"],
    surfaceType: "terrain",
    physical: true,
    outerLoops: [
      [
        { edgeId: "f0", reversed: false, startNodeId: "a", endNodeId: "b", geometry: { kind: "line" } },
        { edgeId: "f1", reversed: false, startNodeId: "b", endNodeId: "c", geometry: { kind: "line" } },
        { edgeId: "f2", reversed: false, startNodeId: "c", endNodeId: "a", geometry: { kind: "line" } },
      ],
    ],
    holes: [],
    nodes: [
      { id: "a", position: { x: 0, y: 0, z: 0 } },
      { id: "b", position: { x: 1, y: 0, z: 0 } },
      { id: "c", position: { x: 0, y: 0, z: 1 } },
    ],
  };
  assert.equal(panelRailOf(flat), undefined);
});

test("a click on a wall opens it and stands a face in the opening", () => {
  const { ctx, patches, holes } = contextFor([STRAIGHT]);

  openingTool.onClick(ctx, { point: { x: 3, y: 0, z: 0 } }, WINDOW);

  assert.equal(patches.length, 1);
  assert.equal(holes.length, 1);

  const { patch } = patches[0];
  assert.equal(patch.regions.length, 1);
  assert.equal(patch.regions[0].surfaceType, "window");
  assert.equal(patch.regions[0].physical, false, "you can see and walk through an opening");
  assert.equal(patch.nodes.length, 4);
  for (const node of patch.nodes) {
    assert.ok(node.position.y >= 1 && node.position.y <= 2, "sill to lintel");
    assert.ok(node.position.x >= 2.4 && node.position.x <= 3.6, "centred on the click");
    assert.equal(node.position.z, 0, "on the wall, not beside it");
  }
});

test("the wall is opened along the very rim the face stands on, walked the other way", () => {
  const { ctx, patches, holes } = contextFor([STRAIGHT]);

  openingTool.onClick(ctx, { point: { x: 3, y: 0, z: 0 } }, WINDOW);

  const face = patches[0].patch.regions[0].boundary;
  const { request } = holes[0];
  assert.deepEqual(request.surfaceKey, ["@region", "wall-1"]);
  assert.deepEqual(
    request.hole,
    [...face].reverse().map((use) => ({ edgeId: use.edgeId, reversed: !use.reversed })),
    "reversing a ring flips every use and the order with it, or the loop stops closing",
  );
  assert.deepEqual(
    [...request.hole].map((use) => use.edgeId).sort(),
    [...face].map((use) => use.edgeId).sort(),
    "one rim, not two coincident ones",
  );
});

test("an opening on a curved wall sits on the curve", () => {
  const { ctx, patches } = contextFor([CURVED]);

  // The renderer picked the panel itself, which is the only exact answer on
  // a curve: the straight line between its two ends runs through open air.
  openingTool.onClick(ctx, { point: { x: 0, y: 0, z: 2 }, surfaceRef: "@region,wall-arc" }, WINDOW);

  assert.equal(patches.length, 1, "a curved wall takes an opening like any other");
  for (const node of patches[0].patch.nodes) {
    const radius = Math.hypot(node.position.x, node.position.z);
    assert.ok(Math.abs(radius - 2) < 1e-3, `corner left the wall: ${JSON.stringify(node.position)}`);
  }
});

test("an opening taller than the wall is refused rather than half-built", () => {
  const { ctx, patches, holes } = contextFor([STRAIGHT]);

  openingTool.onClick(ctx, { point: { x: 3, y: 0, z: 0 } }, { ...WINDOW, height: 5 });

  assert.equal(patches.length, 0, "nothing is registered when it cannot fit");
  assert.equal(holes.length, 0, "and the wall is never opened for a face that will not come");
});

test("a click on open ground opens nothing", () => {
  const { ctx, patches, holes } = contextFor([STRAIGHT]);

  openingTool.onClick(ctx, { point: { x: 3, y: 0, z: 9 } }, WINDOW);

  assert.equal(patches.length, 0);
  assert.equal(holes.length, 0);
});

test("a door sits on the floor of the wall it opens", () => {
  const { ctx, patches } = contextFor([STRAIGHT]);

  openingTool.onClick(ctx, { point: { x: 3, y: 0, z: 0 } }, {
    openingType: "door",
    width: 1,
    height: 2,
    sill: 0,
  });

  const heights = patches[0].patch.nodes.map((node) => node.position.y).sort((a, b) => a - b);
  assert.deepEqual(heights, [0, 0, 2, 2]);
});
