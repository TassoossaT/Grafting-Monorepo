import assert from "node:assert/strict";
import test from "node:test";
import { rulerOf } from "../src/composition/tabletop/tools/core/ruler.ts";
import { HANDLE_MEASUREMENT, collectLinks, snapTurn } from "../src/features/edit-construction/index.ts";

const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message ?? ""} ${a} != ${b}`);
const at = (x, z, y = 0) => ({ x, y, z });
const deg = (n) => (n * Math.PI) / 180;

/** A tool's context as the fixtures build it: nothing but what the table says. */
const context = (extra = {}) => ({ runtime: { getAllRegionTopologies: () => [] }, rulerSnap: true, ...extra });

const standingFloor = {
  surfaceKey: ["floor"], surfaceType: "platform",
  nodes: [{ id: "a", position: at(0, 0, 2) }, { id: "b", position: at(4, 0, 2) }, { id: "c", position: at(4, 3, 2) }, { id: "d", position: at(0, 3, 2) }],
  outerLoops: [[
    { startNodeId: "a", endNodeId: "b", geometry: { kind: "line" } }, { startNodeId: "b", endNodeId: "c", geometry: { kind: "line" } },
    { startNodeId: "c", endNodeId: "d", geometry: { kind: "line" } }, { startNodeId: "d", endNodeId: "a", geometry: { kind: "line" } },
  ]],
  holes: [],
};
const links = collectLinks([standingFloor], { isGround: () => false });

test("a lift reads where the structure stands, not where its handle is drawn: a level a hair off the structure's height lands it", () => {
  // The handle is drawn 0.35 above the node; the structure stands at 1.95, a hair under the floor's level of 2.
  const ruler = rulerOf(context());
  const lifted = ruler.lift({ dragged: at(0, 0, 2.3), standing: 1.95, base: 0, links, rounds: false });
  // The handle moves with it: up by the 0.05 the structure needed.
  near(lifted.y, 2.35);
  assert.equal(lifted.guides[0].kind, "level");
  // Drawn at 2.0 -- which is no level for the structure at 1.65 -- the old reading would have caught; this one does not.
  const far = ruler.lift({ dragged: at(0, 0, 2.0), standing: 1.65, base: 0, links, rounds: false });
  near(far.y, 2.0);
  assert.deepEqual(far.guides, []);
});

test("without a level near, a lift lands on a round number above its base -- and not with the snap off or no step chosen", () => {
  const request = { dragged: at(0, 0, 3.4), standing: 3.04, base: 0, rounds: true };
  const rounded = rulerOf(context({ rulerLengthStep: 0.5 })).lift(request);
  near(rounded.y, 3.4 - 0.04, "the structure goes to 3.0, and the handle with it");
  assert.equal(rounded.guides[0].kind, "step");
  near(rounded.guides[0].meters, 3);
  assert.equal(rulerOf(context({ rulerLengthStep: 0.5, rulerSnap: false })).lift(request).y, 3.4);
  assert.equal(rulerOf(context()).lift(request).y, 3.4);
  assert.equal(rulerOf(context({ rulerLengthStep: 0.5 })).lift({ ...request, rounds: false }).y, 3.4, "a handle that is no height is not rounded");
  // A level that stands beats a round number.
  const both = rulerOf(context({ rulerLengthStep: 0.5 })).lift({ dragged: at(0, 0, 2.3), standing: 1.97, base: 0, links, rounds: true });
  assert.equal(both.guides[0].kind, "level");
});

test("the reach is the screen's: the same lift catches zoomed out and not zoomed in", () => {
  const request = { dragged: at(0, 0, 2.2), standing: 1.8, base: 0, links, rounds: false };
  // 0.2 m off the level: ten pixels at two centimetres a pixel, a hundred at two millimetres.
  assert.equal(rulerOf(context({ rulerMetersPerPixel: 0.02 })).lift(request).guides[0]?.kind, "level");
  assert.deepEqual(rulerOf(context({ rulerMetersPerPixel: 0.002 })).lift(request).guides, []);
});

test("a turn lands on the protractor's step when near one, in the table's step, and not with the snap off", () => {
  const ruler = (extra) => rulerOf(context({ rulerAngleStep: deg(15), ...extra }));
  near(ruler().turn(deg(46), 3).angle, deg(45));
  assert.equal(ruler().turn(deg(46), 3).turns, 3);
  // Far from a step it is left alone, and so with the snap off or no step offered.
  assert.equal(ruler().turn(deg(50), 3).turns, undefined);
  near(ruler({ rulerSnap: false }).turn(deg(46), 3).angle, deg(46));
  near(rulerOf(context()).turn(deg(46), 3).angle, deg(46));
  // The finer step catches what the coarser does not.
  assert.equal(ruler({ rulerAngleStep: deg(5) }).turn(deg(51.2), 3).turns, 10);
  // The resolver says the same on its own.
  near(snapTurn(deg(46), deg(15), 0.2, 3).angle, deg(45));
});

test("what stands is linked but for the faces named: what is edited never links to itself", () => {
  const ctx = context({ runtime: { getAllRegionTopologies: () => [standingFloor] } });
  assert.equal(rulerOf(ctx).linksWithout(new Set()).points.length, 4);
  assert.equal(rulerOf(ctx).linksWithout(new Set([standingFloor.surfaceKey.join("\u0000")])).points.length, 0);
});

test("the handle that is named measures what it declares", () => {
  const ruler = rulerOf(context());
  const using = { direction: { x: 1, z: 0 }, base: 0, angle: deg(30) };
  assert.deepEqual(ruler.named(HANDLE_MEASUREMENT.top, using), { kind: "height", base: 0 });
  assert.deepEqual(ruler.named(HANDLE_MEASUREMENT.side, using), { kind: "side", direction: { x: 1, z: 0 } });
  assert.deepEqual(ruler.named(HANDLE_MEASUREMENT.rotate, using), { kind: "turn", angle: deg(30) });
  assert.equal(HANDLE_MEASUREMENT.detach, "none");
  // A height is what is rounded: the declaration is what says so.
  const heights = Object.entries(HANDLE_MEASUREMENT).filter(([, what]) => what === "height").map(([kind]) => kind).sort();
  assert.deepEqual(heights, ["destinationHeight", "height", "originHeight", "rise", "top"]);
});

test("a value lands on the table's round number when near one, and the road's width is no step of its own", () => {
  const ruler = (extra) => rulerOf(context({ rulerLengthStep: 0.5, ...extra }));
  near(ruler().round(2.04), 2);
  near(ruler().round(2.3), 2.3, "far from a round number: as it is");
  near(ruler({ rulerSnap: false }).round(2.04), 2.04);
  near(rulerOf(context()).round(2.04), 2.04, "no round number chosen: as it is");
  // A step chosen by the table is the step: whole units.
  near(rulerOf(context({ rulerLengthStep: 1 })).round(3.07), 3);
});

test("a catch already held reaches further than the one that took it, by the ruler's own hold", () => {
  const ruler = rulerOf(context());
  assert.ok(ruler.held(0.1) > 0.1 && ruler.held(0.1) < 0.25);
  near(ruler.held(0.5), ruler.held(0.1) * 5);
});

test("the reach of what is built beside, and of what is joined, is the screen's: the same pixels at every zoom", () => {
  near(rulerOf(context({ rulerMetersPerPixel: 0.01 })).reach(40, 0.55), 0.4);
  near(rulerOf(context({ rulerMetersPerPixel: 0.04 })).reach(40, 0.55), 1.2, "limited, however far the camera");
  near(rulerOf(context()).reach(40, 0.55), 0.55, "unknown scale: the fallback in metres");
});
