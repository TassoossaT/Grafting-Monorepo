// An opening put on a sloped roof leaf with the ordinary opening tool, on the
// real runtime and engine: it stands upright where it was clicked, filling
// the front of the cut it makes back into the leaf -- level top, upright
// cheeks, no wall round it -- which follows it and goes when it is deleted.
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
const southLeaf = (runtime) => roofs(runtime).find((f) => !f.props.roofFace.upright && f.props.roofFace.dormer === undefined && f.nodes.some((n) => n.position.z < 1e-6));

/** A gabled roof over 8 x 4 standing on the ground, its south leaf rising 2 in each metre, drawn from `from` to `to`. */
async function gabled(from = { x: 0, z: 0 }, to = { x: 8, z: 4 }) {
  const h = await harness();
  dispatchGesture(roofTool, h.ctx, { ...DEFAULT_TOOL_PARAMS.roof, waters: 2, elevation: 3, height: 4 }, [{ point: { ...from, y: 0 } }, { point: { ...to, y: 0 } }]);
  return h;
}

/** A click of the opening tool on the south leaf at `x`, `z` -- the leaf there at 2z. */
function clickLeaf(h, x, z, params = window) {
  dispatchGesture(openingTool, h.ctx, params, [{ point: { x, y: 2 * z, z }, surfaceRef: ref(southLeaf(h.runtime)) }]);
}

async function roofWithWindow() {
  const h = await gabled();
  clickLeaf(h, 4, 1.2);
  return h;
}

const box = (nodes) => {
  const at = (axis) => nodes.map((n) => n.position[axis]);
  return { x0: Math.min(...at("x")), x1: Math.max(...at("x")), y0: Math.min(...at("y")), y1: Math.max(...at("y")), z: at("z")[0] };
};
// The window fills its dormer's front whole: its extent is the front's, ridge and all.
const openingBox = (h) => box(front(h.runtime).nodes);
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

test("a window clicked on a roof leaf stands there upright, filling the front of its cut, all in one undo step", async () => {
  const h = await roofWithWindow();
  const { runtime, ctx } = h;
  try {
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    assert.equal(dormers(runtime).length, 1);
    const [frontSlope, right, backSlope, left] = dormers(runtime)[0].slopes;
    assert.ok(frontSlope === 0 && backSlope === 0 && right > 0 && right === left, "two waters over it, a gable at its front");
    const wall = front(runtime);
    assert.ok(wall, "the cut's front stands");
    const nodes = h.openings().flatMap((o) => o.nodes);
    assert.ok(nodes.length > 0 && nodes.every((n) => JSON.stringify(pinOf(runtime, n.id)?.hostSurfaceKey) === JSON.stringify(wall.surfaceKey)), "the window is pinned to that front");
    const b = openingBox(h);
    assert.ok(near(b.x1 - b.x0, 0.8) && near(b.y1 - b.y0, 0.6), `the window keeps its size, its top the front's ridge: ${JSON.stringify(b)}`);
    // Placed as a wall's opening filling it: its four corners at its front's, its top laid over the gable.
    const pins = nodes.map((n) => pinOf(runtime, n.id));
    assert.equal(nodes.length, 4, "a plain window takes its four corners");
    assert.ok(pins.every((p) => (near(p.u, 0) || near(p.u, 1)) && (near(p.v, 0) || near(p.v, 1))), `the front is all window: ${JSON.stringify(pins)}`);
    assert.ok(near((b.x0 + b.x1) / 2, 4) && near(b.z, 1.2) && near(b.y0, 2.4), `it stands where it was clicked, on the leaf: ${JSON.stringify(b)}`);
    const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (r) => runtime.cloudFor(r) };
    assert.ok(!shownGlobalHandles(scene).some((handle) => handle.recipeHandle?.anchor?.startsWith("dormer:")), "it has no handles of its own");

    runtime.undoTransaction(ctx.history.undo().transactionId, "local");
    assert.equal(dormers(runtime).length, 0, "one undo takes the cut");
    assert.equal(h.openings().length, 0, "and the window with it");
  } finally { await runtime.dispose?.(); }
});

test("dragging over a roof leaf draws the window corner to corner, as on a wall", async () => {
  const h = await gabled();
  try {
    const leaf = ref(southLeaf(h.runtime));
    // Along the eave for its width, up the leaf for its height: 1.5 wide, 2 x 0.4 tall.
    dispatchGesture(openingTool, h.ctx, window, [{ point: { x: 3, y: 2, z: 1 }, surfaceRef: leaf }, { point: { x: 4.5, y: 2.8, z: 1.4 }, surfaceRef: leaf }]);
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const b = openingBox(h);
    assert.ok(near(b.x0, 3) && near(b.x1, 4.5) && near(b.y0, 2) && near(b.y1, 2.8) && near(b.z, 1), `drawn from corner to corner: ${JSON.stringify(b)}`);
  } finally { await h.runtime.dispose?.(); }
});

test("the roof made again round a window it holds keeps it -- never welded onto the window's own corners", async () => {
  const h = await roofWithWindow();
  const { runtime, ctx } = h;
  try {
    const nodes = h.openings().flatMap((o) => o.nodes);
    const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (r) => runtime.cloudFor(r) };
    const rise = shownGlobalHandles(scene).find((handle) => handle.kind === "rise" && handle.recipeHandle.anchor === "rise");
    const params = { ...DEFAULT_TOOL_PARAMS.roof };
    const start = { nodeId: rise.id, point: rise.position, screenX: 100, screenY: 300 };
    const up = { point: rise.position, screenX: 100, screenY: 260 };
    roofTool.onPointerDown(ctx, start, params);
    roofTool.onPointerMove(ctx, { start, current: up, samples: [start, up] }, params);
    roofTool.onPointerUp(ctx, { start, current: up, samples: [start, up] }, params);
    assert.notEqual(h.feedback.at(-1)?.tone, "error", JSON.stringify(h.feedback.at(-1)));
    assert.ok(nodes.every((n) => JSON.stringify(pinOf(runtime, n.id)?.hostSurfaceKey) === JSON.stringify(front(runtime).surfaceKey)), "the window stays in its front");
  } finally { await runtime.dispose?.(); }
});

test("a roof drawn the other way round takes the window where it was clicked, not mirrored", async () => {
  const h = await gabled({ x: 8, z: 4 }, { x: 0, z: 0 });
  try {
    clickLeaf(h, 2, 1.2);
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const b = openingBox(h);
    assert.ok(near((b.x0 + b.x1) / 2, 2) && near(b.z, 1.2), `at the click: ${JSON.stringify(b)}`);
  } finally { await h.runtime.dispose?.(); }
});

test("hovering a roof leaf shows the window's outline standing there", async () => {
  const h = await gabled();
  try {
    const at = { point: { x: 4, y: 2.4, z: 1.2 }, surfaceRef: ref(southLeaf(h.runtime)) };
    const preview = openingTool.previewFor({ start: at, current: at, samples: [at] }, window, h.ctx);
    assert.ok(preview, "a ghost shows");
  } finally { await h.runtime.dispose?.(); }
});

test("a window asked taller than the roof behind it stops there: the ghost shows the stop, and the commit makes just that", async () => {
  const h = await gabled();
  try {
    const tall = { ...window, height: 3 };
    const at = { point: { x: 4, y: 2.4, z: 1.2 }, surfaceRef: ref(southLeaf(h.runtime)) };
    const preview = openingTool.previewFor({ start: at, current: at, samples: [at] }, tall, h.ctx);
    const ys = [];
    for (let i = 1; i < preview.positions.length; i += 3) ys.push(preview.positions[i]);
    clickLeaf(h, 4, 1.2, tall);
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const b = openingBox(h);
    // The leaf rises to its ridge at 4, 0.8 behind the front standing at 2.4: the window's top -- its front's ridge --
    // meets the leaf just short of that ridge.
    assert.ok(b.y1 < 4 && b.y1 > 3.9, `stopped under the ridge: ${JSON.stringify(b)}`);
    assert.ok(near(Math.max(...ys), b.y1) && near(Math.min(...ys), b.y0), `the ghost showed what was made: ${Math.min(...ys)}..${Math.max(...ys)} vs ${b.y0}..${b.y1}`);
  } finally { await h.runtime.dispose?.(); }
});

test("a window asked wider than its leaf runs stops at the leaf's end", async () => {
  const h = await gabled();
  try {
    clickLeaf(h, 0.5, 1.2, { ...window, width: 2 });
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const b = openingBox(h);
    assert.ok(b.x0 > 0 && b.x0 < 0.05 && near(b.x1, 1.5), `stopped at the gable end, its far side where asked: ${JSON.stringify(b)}`);
  } finally { await h.runtime.dispose?.(); }
});

test("resizing a roof window past the roof stops it there instead of refusing", async () => {
  const h = await roofWithWindow();
  try {
    const b = openingBox(h);
    const top = { x: (b.x0 + b.x1) / 2, y: b.y1, z: b.z };
    press(h, window, top, { ...top, y: top.y + 5 });
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const grown = openingBox(h);
    assert.ok(grown.y1 > b.y1 + 0.5 && grown.y1 < 4, `grown up to the stop: ${JSON.stringify(grown)}`);
  } finally { await h.runtime.dispose?.(); }
});

test("dragging the window moves its cut over the leaf", async () => {
  const h = await roofWithWindow();
  const { runtime } = h;
  try {
    const was = dormers(runtime)[0];
    const b = openingBox(h);
    const middle = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: b.z };
    press(h, window, middle, { ...middle, x: middle.x + 1 });
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const now = dormers(runtime)[0];
    assert.ok(near((now.along - was.along) * 8, 1, 1e-6), `it moved a metre along the eave: ${was.along} -> ${now.along}`);
    const moved = openingBox(h);
    assert.ok(near((moved.x0 + moved.x1) / 2, middle.x + 1, 1e-4), "the window went with it");
  } finally { await runtime.dispose?.(); }
});

test("widening the window widens its cut", async () => {
  const h = await roofWithWindow();
  const { runtime } = h;
  try {
    const b = openingBox(h);
    const edge = { x: b.x1, y: (b.y0 + b.y1) / 2, z: b.z };
    press(h, window, edge, { ...edge, x: edge.x + 0.6 });
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    const grown = openingBox(h);
    assert.ok(near(grown.x1 - grown.x0, 1.4), `the window is wider: ${JSON.stringify(grown)}`);
    assert.ok(near(dormers(runtime)[0].width, 1.4), "its cut is exactly as wide");
  } finally { await runtime.dispose?.(); }
});

for (const [name, shape] of [
  ["an arched window", { ellipse: false, radii: { top: 0.4, right: 0, bottom: 0, left: 0 } }],
  ["a round window", { ellipse: true, radii: { top: 0, right: 0, bottom: 0, left: 0 } }],
]) {
  test(`${name} on a roof leaf keeps its curve, standing upright`, async () => {
    const h = await gabled();
    try {
      clickLeaf(h, 4, 1.2, { ...window, height: 0.8, shape });
      assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
      const pieces = h.openings();
      assert.ok(pieces.length > 0 && pieces.every((piece) => piece.props?.openingShape !== undefined), `the window keeps its shape: ${JSON.stringify(pieces.map((p) => [p.props, p.nodes.length]))}`);
      const zs = pieces.flatMap((piece) => piece.nodes.map((n) => n.position.z));
      assert.ok(Math.max(...zs) - Math.min(...zs) < 1e-4, "it stands upright");
    } finally { await h.runtime.dispose?.(); }
  });
}

/** Drags the roof handle `anchor` up (`dy` < 0 px) or down, 40 px a metre. */
function dragRoofHandle(h, anchor, dy) {
  const { runtime, ctx } = h;
  const scene = { graph: runtime.getGraphSnapshot(), topologies: runtime.getAllRegionTopologies(), cloudFor: (r) => runtime.cloudFor(r) };
  const handle = shownGlobalHandles(scene).find((candidate) => candidate.recipeHandle?.anchor === anchor);
  assert.ok(handle, `a handle ${anchor}`);
  const params = { ...DEFAULT_TOOL_PARAMS.roof };
  const start = { nodeId: handle.id, point: handle.position, screenX: 100, screenY: 300 };
  const current = { point: handle.position, screenX: 100, screenY: 300 + dy };
  roofTool.onPointerDown(ctx, start, params);
  roofTool.onPointerMove(ctx, { start, current, samples: [start, current] }, params);
  roofTool.onPointerUp(ctx, { start, current, samples: [start, current] }, params);
}

test("a window's dormer is made one water by bringing one of its waters down, the window filling its new front", async () => {
  const h = await roofWithWindow();
  const { runtime } = h;
  try {
    dragRoofHandle(h, "slope:-:0:1", 200);
    assert.notEqual(h.feedback.at(-1)?.tone, "error", JSON.stringify(h.feedback.at(-1)));
    const slopes = dormers(runtime)[0].slopes;
    assert.ok(slopes[1] === 0 && slopes[3] > 0, `one water: ${slopes}`);
    const b = openingBox(h), f = box(front(runtime).nodes);
    assert.ok(near(b.x0, f.x0) && near(b.x1, f.x1) && near(b.y0, f.y0) && near(b.y1, f.y1), `still all window: ${JSON.stringify({ b, f })}`);
    // Brought down again, the other stays: never no water at all.
    dragRoofHandle(h, "slope:-:0:3", 200);
    const still = dormers(runtime)[0].slopes;
    assert.ok(still[1] > 0 || still[3] > 0, `a water is kept: ${still}`);
  } finally { await runtime.dispose?.(); }
});

test("raising the roof leaves a window's dormer and the window as they stand", async () => {
  const h = await roofWithWindow();
  const { runtime } = h;
  try {
    const was = openingBox(h);
    dragRoofHandle(h, "rise", -40);
    assert.notEqual(h.feedback.at(-1)?.tone, "error", JSON.stringify(h.feedback.at(-1)));
    const now = openingBox(h);
    assert.ok(near(now.y1 - now.y0, was.y1 - was.y0) && near(now.x1 - now.x0, was.x1 - was.x0), `the window kept its size: ${JSON.stringify({ was, now })}`);
  } finally { await runtime.dispose?.(); }
});

test("reshaping a selected roof window round keeps its size and its dormer", async () => {
  const h = await roofWithWindow();
  const { runtime, ctx } = h;
  try {
    const was = openingBox(h);
    const middle = { x: (was.x0 + was.x1) / 2, y: (was.y0 + was.y1) / 2, z: was.z };
    press(h, window, middle);
    const dormerBefore = dormers(runtime)[0];
    openingTool.onParamsChange(ctx, { ...window, shape: { ellipse: true, radii: { top: 0, right: 0, bottom: 0, left: 0 } } });
    assert.equal(h.feedback.at(-1)?.tone, "success", JSON.stringify(h.feedback.at(-1)));
    assert.ok(h.openings().every((piece) => piece.props?.openingShape?.ellipse === true), "it is round now");
    assert.ok(near(dormers(runtime)[0].width, dormerBefore.width) && near(dormers(runtime)[0].front, dormerBefore.front), "its dormer as it stood");
  } finally { await runtime.dispose?.(); }
});

for (const [name, shape, most] of [
  ["a plain window", undefined, 4],
  ["a round window", { ellipse: true, radii: { top: 0, right: 0, bottom: 0, left: 0 } }, 8],
]) {
  test(`${name} in a gabled front takes only the corners it needs`, async () => {
    const h = await gabled();
    try {
      clickLeaf(h, 4, 1.2, { ...window, height: 0.8, ...(shape ? { shape } : {}) });
      const count = h.openings().reduce((sum, piece) => sum + piece.nodes.length, 0);
      assert.ok(count > 3 && count <= most, `${count} corners`);
    } finally { await h.runtime.dispose?.(); }
  });
}

test("deleting the window removes its cut", async () => {
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
