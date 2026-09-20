import assert from "node:assert/strict";
import test from "node:test";

import { planEdit, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";

/** A single straight wall panel with a rectangular opening standing in it, built directly against the real WASM session. */
function wallWithOpening(runtime) {
  const wallNodes = [
    { id: "w:a-bottom", position: { x: 0, y: 0, z: 0 } },
    { id: "w:b-bottom", position: { x: 4, y: 0, z: 0 } },
    { id: "w:b-top", position: { x: 4, y: 3, z: 0 } },
    { id: "w:a-top", position: { x: 0, y: 3, z: 0 } },
  ];
  const holeNodes = [
    { id: "h:0", position: { x: 1, y: 1, z: 0 } },
    { id: "h:1", position: { x: 2, y: 1, z: 0 } },
    { id: "h:2", position: { x: 2, y: 2, z: 0 } },
    { id: "h:3", position: { x: 1, y: 2, z: 0 } },
  ];
  const edges = (nodes, prefix) => nodes.map((n, i) => ({ edgeId: `${prefix}:${i}`, startNodeId: n.id, endNodeId: nodes[(i + 1) % nodes.length].id }));
  const wallEdges = edges(wallNodes, "wall");
  const holeEdges = edges(holeNodes, "hole");
  const uses = (es) => es.map((e) => ({ edgeId: e.edgeId, reversed: false }));
  // The wall's hole and the opening's own face are the SAME rim, one edge
  // used forwards by the face and backwards by the wall's hole -- exactly
  // how `opening-tool.ts`'s real onClick commits it (patch first, then the
  // hole on the same boundary reversed).
  const holeUses = uses(holeEdges);
  const wallHole = [...holeUses].reverse().map((use) => ({ edgeId: use.edgeId, reversed: !use.reversed }));
  runtime.addPatch({
    nodes: [...wallNodes, ...holeNodes],
    edges: [...wallEdges, ...holeEdges],
    regions: [
      { regionId: "wall-with-opening", boundary: uses(wallEdges), holes: [wallHole], surfaceType: "wall-white", physical: true },
      { regionId: "opening-face", boundary: holeUses, surfaceType: "opening", physical: false },
    ],
  });
  return runtime.getAllRegionTopologies().find((t) => t.nodes.some((n) => n.id === "w:a-bottom"));
}

test("real WASM: dragging the wall's bottom edge sideways carries the opening standing in it", () => {
  const { runtime, session } = sessionFixture();
  try {
    const wall = wallWithOpening(runtime);
    const bottomEdgeId = wall.outerLoops[0].find((e) => e.startNodeId === "w:a-bottom" && e.endNodeId === "w:b-bottom").edgeId;
    const cloud = resolveCloudTopology(runtime, wall.surfaceKey);
    const plan = planEdit(cloud, { surfaceKey: wall.surfaceKey, target: { kind: "edge", edgeId: bottomEdgeId }, delta: { x: 2, y: 0, z: 0 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    const outcome = runtime.applyRegionEdit(plan.ops);
    const after = new Map(runtime.getGraphSnapshot().nodes.map((n) => [n.id, n.position]));
    assert.equal(after.get("h:0").x, 3, "the opening's own rim must ride along with the wall segment it stands in");
    assert.equal(after.get("h:2").x, 4);

    // Both faces sharing the moved rim must come back as affected, or the
    // render layer has no signal to re-mesh the opening's own face -- the
    // wall's hole would then move in the data while the door/window panel
    // itself stays rendered exactly where it used to be.
    const opening = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "opening");
    const affected = new Set(outcome.affectedSurfaceKeys.map((key) => key.join(" ")));
    assert.ok(affected.has(wall.surfaceKey.join(" ")), "wall must be reported affected");
    assert.ok(affected.has(opening.surfaceKey.join(" ")), "the opening's own face must be reported affected too");
  } finally { session.free(); }
});
