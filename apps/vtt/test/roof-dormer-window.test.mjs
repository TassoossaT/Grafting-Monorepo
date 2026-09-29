// A window put in a dormer's front with the ordinary opening tool, on the
// real runtime and engine, and kept there when the roof is made again.
import assert from "node:assert/strict";
import test from "node:test";

import { dispatchGesture, harness, press, ref } from "./support/opening-harness.mjs";
import { DEFAULT_TOOL_PARAMS, shownGlobalHandles } from "../src/features/edit-construction/index.ts";
import { roofTool } from "../src/composition/tabletop/tools/roof/roof-tool.ts";

const roofs = (runtime) => runtime.getAllRegionTopologies().filter((f) => f.surfaceType === "roof");
const front = (runtime) => roofs(runtime).find((f) => f.props.roofFace.dormer === 0 && f.props.roofFace.upright && f.props.roofFace.side === 0);
const pinOf = (runtime, id) => runtime.getAllRegionTopologies().flatMap((f) => f.nodes).find((n) => n.id === id)?.pin;

test("a dormer's front takes a window from the opening tool, and keeps it when the roof rises", async () => {
  const h = await harness();
  const { runtime, ctx } = h;
  const roofParams = { ...DEFAULT_TOOL_PARAMS.roof, waters: 2, elevation: 3, height: 4 };
  dispatchGesture(roofTool, ctx, roofParams, [{ point: { x: 0, y: 0, z: 0 } }, { point: { x: 8, y: 0, z: 4 } }]);
  const leaf = roofs(runtime).find((f) => !f.props.roofFace.upright && f.nodes.some((n) => n.position.z < 1e-6));
  dispatchGesture(roofTool, ctx, { ...roofParams, action: "dormer" }, [{ point: { x: 4, y: 4, z: 0.6 }, surfaceRef: ref(leaf) }]);
  const wall = front(runtime);
  assert.ok(wall, JSON.stringify(h.feedback.at(-1)));
  const ys = wall.nodes.map((n) => n.position.y);
  const middle = { x: 4, y: (Math.min(...ys) + Math.max(...ys)) / 2, z: 0.6 };
  press(h, { ...DEFAULT_TOOL_PARAMS.opening, width: 0.6, height: 0.6 }, middle, middle, { surfaceRef: ref(wall) });
  assert.equal(h.openings().length > 0, true, JSON.stringify(h.feedback.slice(-2)));
  const node = h.openings()[0].nodes[0];
  assert.deepEqual(pinOf(runtime, node.id)?.hostSurfaceKey, wall.surfaceKey);
  const { u, v } = pinOf(runtime, node.id);

  const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (r) => runtime.cloudFor(r) };
  const rise = shownGlobalHandles(scene).find((handle) => handle.kind === "rise" && handle.recipeHandle.anchor === "rise");
  const start = { nodeId: rise.id, point: rise.position, screenX: 100, screenY: 300 };
  const up = { point: rise.position, screenX: 200, screenY: 260 };
  roofTool.onPointerDown(ctx, start, roofParams);
  roofTool.onPointerMove(ctx, { start, current: up, samples: [start, up] }, roofParams);
  roofTool.onPointerUp(ctx, { start, current: up, samples: [start, up] }, roofParams);

  const now = front(runtime);
  assert.notDeepEqual(now.surfaceKey, wall.surfaceKey, "the roof was made again");
  const pin = pinOf(runtime, node.id);
  assert.deepEqual(pin?.hostSurfaceKey, now.surfaceKey);
  assert.ok(Math.abs(pin.u - u) < 1e-9 && Math.abs(pin.v - v) < 1e-9);
  await runtime.dispose?.();
});
