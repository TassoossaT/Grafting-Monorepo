import assert from "node:assert/strict";
import test from "node:test";

import { openingTool } from "../src/composition/tabletop/tools/openings/opening-tool.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

/**
 * Drives the real `openingTool` through the dispatcher's own gesture shape
 * (`onPointerDown` -> `onPointerUp` -> `onClick`) against a real WASM
 * session -- the regressions this covers are about the gesture model
 * itself (what a press on an existing opening vs. a plain click on empty
 * wall does), not the pure rail math `opening-tool.test.mjs` already
 * covers.
 */

const WINDOW = { openingKind: "window", width: 1, height: 1, sill: 1 };

function wall(runtime) {
  return addFace(runtime, "wall", "wall-white", [
    { id: "w:a-bottom", position: { x: 0, y: 0, z: 0 } },
    { id: "w:b-bottom", position: { x: 8, y: 0, z: 0 } },
    { id: "w:b-top", position: { x: 8, y: 3, z: 0 } },
    { id: "w:a-top", position: { x: 0, y: 3, z: 0 } },
  ]);
}

function openingAt(ctx, x) {
  return ctx.runtime.getAllRegionTopologies().find(
    (t) => t.surfaceType === "opening" && t.nodes.some((n) => Math.abs(n.position.x - x) < 0.6),
  );
}

/** A full down -> (optional move) -> up -> click cycle, the same order `use-construction-pointer.ts` fires them in. */
function gesture(ctx, params, downPoint, upPoint = downPoint) {
  const surfaceRef = (point) => {
    const opening = openingAt(ctx, point.x);
    return opening ? surfaceRefFromNodeSet(opening.surfaceKey) : undefined;
  };
  openingTool.onPointerDown(ctx, { point: downPoint, surfaceRef: surfaceRef(downPoint) }, params);
  openingTool.onPointerUp?.(ctx, { start: { point: downPoint }, current: { point: upPoint } }, params);
  openingTool.onClick(ctx, { point: upPoint, surfaceRef: surfaceRef(upPoint) }, params);
}

test("pressing directly on an existing opening and releasing on the same spot only selects it -- no stacked second opening", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    wall(runtime);
    openingTool.onClick(ctx, { point: { x: 4, y: 0, z: 0 } }, WINDOW);
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening").length, 1);

    gesture(ctx, WINDOW, { x: 4, y: 0, z: 0 });

    assert.equal(
      runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening").length,
      1,
      "a plain click on the opening itself must select it, never stamp a second one on top",
    );
  } finally { session.free(); }
});

test("creating a second opening squarely on top of an existing one is refused, not stacked", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    wall(runtime);
    openingTool.onClick(ctx, { point: { x: 4, y: 0, z: 0 } }, WINDOW);
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening").length, 1);

    // No surfaceRef this time -- the same ambiguous "picked the wall, not
    // the opening standing in it" case a raycast can genuinely land on.
    openingTool.onClick(ctx, { point: { x: 4, y: 0, z: 0 } }, WINDOW);

    assert.equal(
      runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening").length,
      1,
      "the overlap guard on the create path must refuse a second opening stacked on the first",
    );
  } finally { session.free(); }
});

test("with one opening selected, a plain click elsewhere on the wall creates an independent second opening instead of moving the first", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    wall(runtime);
    openingTool.onClick(ctx, { point: { x: 1.5, y: 0, z: 0 } }, WINDOW);
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening").length, 1);

    // Select the first opening: a plain grab-and-release with no movement.
    gesture(ctx, WINDOW, { x: 1.5, y: 0, z: 0 });
    assert.ok(openingAt(ctx, 1.5) !== undefined, "the first opening must still be exactly where it was");

    // A later click far away on empty wall, with nothing grabbed this
    // gesture, must create -- not be swallowed as "move the selection".
    openingTool.onPointerDown(ctx, { point: { x: 6, y: 0, z: 0 } }, WINDOW);
    openingTool.onPointerUp(ctx, { start: { point: { x: 6, y: 0, z: 0 } }, current: { point: { x: 6, y: 0, z: 0 } } }, WINDOW);
    openingTool.onClick(ctx, { point: { x: 6, y: 0, z: 0 } }, WINDOW);

    const openings = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");
    assert.equal(openings.length, 2, "both openings must now exist independently");
    assert.ok(openingAt(ctx, 1.5) !== undefined, "the first opening must not have been moved");
    assert.ok(openingAt(ctx, 6) !== undefined, "the second opening must have been created where clicked");
  } finally { session.free(); }
});

test("dragging an existing opening to a new spot on the wall moves it, and frees its old spot", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    wall(runtime);
    openingTool.onClick(ctx, { point: { x: 1.5, y: 0, z: 0 } }, WINDOW);
    assert.ok(openingAt(ctx, 1.5) !== undefined);

    gesture(ctx, WINDOW, { x: 1.5, y: 0, z: 0 }, { x: 6, y: 0, z: 0 });

    const openings = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");
    assert.equal(openings.length, 1, "a move replaces the opening, it does not add a second one");
    assert.equal(openingAt(ctx, 1.5), undefined, "the old spot must be free again");
    assert.ok(openingAt(ctx, 6) !== undefined, "the opening must now stand where it was dragged to");
  } finally { session.free(); }
});

test("grabbing still finds and drags an existing opening even when the renderer's own pick misses its face and reports no surfaceRef at all", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    wall(runtime);
    // y=0.5 places this window's own pane at [0.5, 1.5] (height 1, clicked
    // height 0.5, nothing to clamp) -- a known range the grab below can aim into.
    openingTool.onClick(ctx, { point: { x: 1.5, y: 0.5, z: 0 } }, WINDOW);
    assert.ok(openingAt(ctx, 1.5) !== undefined);

    // No surfaceRef anywhere in this gesture -- `openingNear`'s geometric
    // fallback must still resolve the opening standing exactly at this spot.
    // y=1.0 lands inside that pane, same as a real click would need to for
    // the renderer to have any hope of hitting it.
    openingTool.onPointerDown(ctx, { point: { x: 1.5, y: 1.0, z: 0 } }, WINDOW);
    openingTool.onPointerUp(
      ctx,
      { start: { point: { x: 1.5, y: 1.0, z: 0 } }, current: { point: { x: 6, y: 1.0, z: 0 } } },
      WINDOW,
    );
    openingTool.onClick(ctx, { point: { x: 6, y: 0, z: 0 } }, WINDOW);

    const openings = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");
    assert.equal(openings.length, 1, "still a move, not a stacked create -- proves the grab (not the create path) handled it");
    assert.ok(openingAt(ctx, 6) !== undefined, "the opening moved to where the drag released");
  } finally { session.free(); }
});

test("placing a window right beside an existing window of the same kind merges them into one wider opening", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    wall(runtime);
    openingTool.onClick(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5]
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening").length, 1);

    openingTool.onClick(ctx, { point: { x: 3.2, y: 1, z: 0 } }, WINDOW); // rim [2.7, 3.7] -- 0.2 short of flush

    const openings = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");
    assert.equal(openings.length, 1, "the two windows must merge into one, not stand side by side as two");
    const xs = openings[0].nodes.map((n) => n.position.x);
    assert.ok(Math.abs(Math.min(...xs) - 1.5) < 1e-6, `expected the merged opening to start at 1.5, got ${Math.min(...xs)}`);
    assert.ok(Math.abs(Math.max(...xs) - 3.7) < 1e-6, `expected the merged opening to end at 3.7, got ${Math.max(...xs)}`);
  } finally { session.free(); }
});

test("a door placed beside a window never merges -- only the same kind absorbs a neighbor", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    wall(runtime);
    openingTool.onClick(ctx, { point: { x: 2, y: 1, z: 0 } }, WINDOW); // rim [1.5, 2.5], height [1, 2]
    const DOOR = { openingKind: "door", width: 1, height: 2, sill: 0 };
    openingTool.onClick(ctx, { point: { x: 3.2, y: 0, z: 0 } }, DOOR); // rim [2.7, 3.7], height [0, 2] -- overlaps the window's height band, close enough to merge, but a different kind

    const openings = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");
    assert.equal(openings.length, 2, "different kinds must never merge into each other");
  } finally { session.free(); }
});

test("dragging a window flush against another window of the same kind merges them too", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    wall(runtime);
    openingTool.onClick(ctx, { point: { x: 1, y: 1, z: 0 } }, WINDOW); // rim [0.5, 1.5]
    openingTool.onClick(ctx, { point: { x: 6, y: 1, z: 0 } }, WINDOW); // rim [5.5, 6.5]
    assert.equal(runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening").length, 2);

    const target = openingAt(ctx, 6);
    const surfaceRef = surfaceRefFromNodeSet(target.surfaceKey);
    openingTool.onPointerDown(ctx, { point: { x: 6, y: 1, z: 0 }, surfaceRef }, WINDOW);
    openingTool.onPointerUp(ctx, { start: { point: { x: 6, y: 1, z: 0 } }, current: { point: { x: 2.2, y: 1, z: 0 } } }, WINDOW); // rim [1.7, 2.7] -- 0.2 short of flush against the first
    openingTool.onClick(ctx, { point: { x: 2.2, y: 1, z: 0 }, surfaceRef }, WINDOW);

    const openings = runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");
    assert.equal(openings.length, 1, "dragging one window flush against another must merge them");
  } finally { session.free(); }
});
