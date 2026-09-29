// An opening put on a sloped roof leaf with the ordinary opening tool, on the
// real runtime and engine: it stands upright in a dormer raised for it, which
// follows it when it moves or grows, and goes when it is deleted.
import assert from "node:assert/strict";
import test from "node:test";

import { dispatchGesture, harness, press, ref } from "./support/opening-harness.mjs";
import { DEFAULT_TOOL_PARAMS, shownGlobalHandles } from "../src/features/edit-construction/index.ts";
import { roofTool } from "../src/composition/tabletop/tools/roof/roof-tool.ts";
import { openingTool } from "../src/composition/tabletop/tools/openings/opening-tool.ts";

const roofs = (runtime) => runtime.getAllRegionTopologies().filter((f) => f.props?.roof !== undefined);
const dormers = (runtime) => roofs(runtime)[0]?.props.roof.dormers ?? [];
const front = (runtime, k = 0) => roofs(runtime).find((f) => f.props.roofFace.dormer === k && f.props.roofFace.upright && f.props.roofFace.side === 0);
const pinOf = (runtime, id) => runtime.getAllRegionTopologies().flatMap((f) => f.nodes).find((n) => n.id === id)?.pin;
const window = { ...DEFAULT_TOOL_PARAMS.opening, openingKind: "window", width: 0.8, height: 0.6 };

/** A gabled roof over 8 x 4, its south leaf rising 2 in each metre, and a window clicked onto that leaf. */
async function roofWithWindow() {
  const h = await harness();
  dispatchGesture(roofTool, h.ctx, { ...DEFAULT_TOOL_PARAMS.roof, waters: 2, elevation: 3, height: 4 }, [{ point: { x: 0, y: 0, z: 0 } }, { point: { x: 8, y: 0, z: 4 } }]);
  const leaf = roofs(h.runtime).find((f) => !f.props.roofFace.upright && f.nodes.some((n) => n.position.z < 1e-6));
  dispatchGesture(openingTool, h.ctx, window, [{ point: { x: 4, y: 5.4, z: 1.2 }, surfaceRef: ref(leaf) }]);
  return h;
}

const box = (nodes) => {
  const at = (axis) => nodes.map((n) => n.position[axis]);
  return { x0: Math.min(...at("x")), x1: Math.max(...at("x")), y0: Math.min(...at("y")), y1: Math.max(...at("y")), z: at("z")[0] };
};
const openingBox = (h) => box(h.openings().flatMap((o) => o.nodes));

test("a window clicked on a roof leaf stands in a dormer raised for it, all in one undo step", async () => {
  const h = await roofWithWindow();
  const { runtime, ctx } = h;
  try {
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    assert.equal(dormers(runtime).length, 1);
    assert.equal(dormers(runtime)[0].opening, true);
    const wall = front(runtime);
    assert.ok(wall, "the dormer's front stands");
    assert.equal(h.openings().length > 0, true);
    const nodes = h.openings().flatMap((o) => o.nodes);
    assert.ok(nodes.every((n) => JSON.stringify(pinOf(runtime, n.id)?.hostSurfaceKey) === JSON.stringify(wall.surfaceKey)), "the window is pinned to that front");
    const b = openingBox(h);
    assert.ok(Math.abs(b.x1 - b.x0 - 0.8) < 1e-4 && Math.abs(b.y1 - b.y0 - 0.6) < 1e-4, `the window keeps its size: ${JSON.stringify(b)}`);
    assert.ok(Math.abs((b.x0 + b.x1) / 2 - 4) < 1e-4, "centred where it was clicked");
    // The dormer shows none of its own handles: it is shaped through its window.
    const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (r) => runtime.cloudFor(r) };
    assert.ok(!shownGlobalHandles(scene).some((handle) => handle.recipeHandle?.anchor?.startsWith("dormer:")));

    runtime.undoTransaction(ctx.history.undo().transactionId, "local");
    assert.equal(dormers(runtime).length, 0, "one undo takes the dormer");
    assert.equal(h.openings().length, 0, "and the window with it");
  } finally { await runtime.dispose?.(); }
});

test("dragging the window moves its dormer over the leaf", async () => {
  const h = await roofWithWindow();
  const { runtime } = h;
  try {
    const was = dormers(runtime)[0];
    const b = openingBox(h);
    const middle = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: b.z };
    press(h, window, middle, { ...middle, x: middle.x + 1 });
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const now = dormers(runtime)[0];
    assert.ok(Math.abs((now.along - was.along) * 8 - 1) < 1e-6, `the dormer moved a metre along the eave: ${was.along} -> ${now.along}`);
    const moved = openingBox(h);
    assert.ok(Math.abs((moved.x0 + moved.x1) / 2 - (middle.x + 1)) < 1e-4, "the window went with it");
    assert.ok(h.openings().flatMap((o) => o.nodes).every((n) => JSON.stringify(pinOf(runtime, n.id)?.hostSurfaceKey) === JSON.stringify(front(runtime).surfaceKey)));
  } finally { await runtime.dispose?.(); }
});

test("widening the window past its dormer widens the dormer", async () => {
  const h = await roofWithWindow();
  const { runtime } = h;
  try {
    const b = openingBox(h);
    const edge = { x: b.x1, y: (b.y0 + b.y1) / 2, z: b.z };
    press(h, window, edge, { ...edge, x: edge.x + 0.6 });
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const grown = openingBox(h);
    assert.ok(Math.abs(grown.x1 - grown.x0 - 1.4) < 1e-3, `the window is wider: ${JSON.stringify(grown)}`);
    assert.ok(Math.abs(dormers(runtime)[0].width - (1.4 + 0.3)) < 1e-3, "its dormer keeps a margin round it");
  } finally { await runtime.dispose?.(); }
});

for (const [name, shape] of [
  ["an arched window", { ellipse: false, radii: { top: 0.4, right: 0, bottom: 0, left: 0 } }],
  ["a round window", { ellipse: true, radii: { top: 0, right: 0, bottom: 0, left: 0 } }],
]) {
  test(`${name} on a roof leaf keeps its curve, cut in its dormer's upright front`, async () => {
    const h = await harness();
    const { runtime } = h;
    try {
      dispatchGesture(roofTool, h.ctx, { ...DEFAULT_TOOL_PARAMS.roof, waters: 2, elevation: 3, height: 4 }, [{ point: { x: 0, y: 0, z: 0 } }, { point: { x: 8, y: 0, z: 4 } }]);
      const leaf = roofs(runtime).find((f) => !f.props.roofFace.upright && f.nodes.some((n) => n.position.z < 1e-6));
      dispatchGesture(openingTool, h.ctx, { ...window, height: 0.8, shape }, [{ point: { x: 4, y: 5.4, z: 1.2 }, surfaceRef: ref(leaf) }]);
      assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
      const pieces = h.openings();
      assert.ok(pieces.length > 0 && pieces.every((piece) => piece.props?.openingShape !== undefined), "the window keeps its shape");
      // Upright: every corner of it stands on one plane parallel to the eave.
      const zs = pieces.flatMap((piece) => piece.nodes.map((n) => n.position.z));
      assert.ok(Math.max(...zs) - Math.min(...zs) < 1e-4, "it stands upright");
      assert.equal(dormers(runtime).length, 1);
    } finally { await runtime.dispose?.(); }
  });
}

test("deleting the window removes its dormer", async () => {
  const h = await roofWithWindow();
  const { runtime, ctx } = h;
  try {
    const b = openingBox(h);
    const middle = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: b.z };
    press(h, window, middle);
    openingTool.onDeleteKey(ctx);
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    assert.equal(h.openings().length, 0);
    assert.equal(dormers(runtime).length, 0);
    assert.ok(roofs(runtime).length > 0, "the roof stays");
  } finally { await runtime.dispose?.(); }
});
