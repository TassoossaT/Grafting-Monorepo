import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_LENGTH_STEP, DEFAULT_RULER_SETTINGS, lengthStepOf, niceStep, parseRulerSettings, resolveRuler, roundReach, serializeRulerSettings } from "../src/features/edit-construction/index.ts";
import { rulerOf } from "../src/composition/tabletop/tools/core/ruler.ts";

const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, `${message ?? ""} ${a} != ${b}`);
const at = (x, z, y = 0) => ({ x, y, z });
const empty = { points: [], runs: [], levels: [] };
const only = new Set(["align", "square", "intersection", "angle", "polar", "length"].filter((kind) => kind !== "length"));

test("the automatic step is the coarsest round number that still stands apart on the screen -- it follows the zoom", () => {
  // At two millimetres a pixel, thirty pixels are 6 cm: the round number of 0.1.
  near(niceStep(0.002, "m", 30), 0.1);
  // At seven millimetres a pixel, 21 cm: a quarter of a metre.
  near(niceStep(0.007, "m", 30), 0.25);
  // Zoomed out, it grows: at a decimetre a pixel, three metres: five.
  near(niceStep(0.1, "m", 30), 5);
  // In feet the round numbers are feet: at 7 mm a pixel, 21 cm is not yet a foot (30.5 cm), so a foot is the first that stands apart.
  near(niceStep(0.007, "ft", 30), 0.3048);
  // No scale to read: a whole unit.
  near(niceStep(undefined, "m", 30), 1);
});

test("the table's setting is a step in its unit, none, or the automatic one", () => {
  near(lengthStepOf(AUTO_LENGTH_STEP, 0.007, "m"), 0.25);
  near(lengthStepOf(2, 0.007, "m"), 2);
  near(lengthStepOf(5, 0.007, "ft"), 5 * 0.3048);
  assert.equal(lengthStepOf(0, 0.007, "m"), undefined);
});

test("the automatic step is what a table starts with, and is kept", () => {
  assert.equal(DEFAULT_RULER_SETTINGS.lengthStep, "auto");
  const back = parseRulerSettings(JSON.parse(JSON.stringify(serializeRulerSettings({ ...DEFAULT_RULER_SETTINGS }))));
  assert.equal(back.lengthStep, "auto");
  assert.equal(parseRulerSettings({ lengthStep: "auto" }).lengthStep, "auto");
  assert.equal(parseRulerSettings({ lengthStep: 0 }).lengthStep, 0, "a table that turned it off keeps it off");
  assert.equal(parseRulerSettings({ lengthStep: "banana" }).lengthStep, "auto", "an unreadable choice is the default");
  assert.equal(parseRulerSettings(["corner"]).lengthStep, "auto", "the old form is the default too");
});

test("a round number's reach is stronger than a join's, and never more than a share of the step", () => {
  near(roundReach(1, 0.17), 0.17, "a coarse step: the pixel reach");
  near(roundReach(0.25, 0.17), 0.1, "a fine one: held to 40 per cent of it, so a length between two round numbers stays free");
});

test("a length near a round number lands on it, from a good way off -- 2.91 is 3, and 2.97 never happens", () => {
  const rule = (x, extra = {}) => resolveRuler({ point: at(x, 0), origin: at(0, 0), links: empty, lengthStep: 0.25, stepReach: 0.17, ...extra });
  // Nine centimetres from three: the reach is held to 0.4 of a quarter, which is ten.
  near(rule(2.91).position.x, 3);
  near(rule(2.97).position.x, 3);
  near(rule(3.04).position.x, 3);
  near(rule(3.21).position.x, 3.25);
  assert.equal(rule(2.91).caught, "step");
});

test("but a length between two round numbers is left free: what is not near one is as drawn", () => {
  const free = resolveRuler({ point: at(3.12, 0), origin: at(0, 0), links: empty, lengthStep: 0.25, stepReach: 0.17 });
  assert.equal(free.caught, undefined);
  near(free.position.x, 3.12);
  // A coarse step leaves more free, not less: a length near a whole metre lands, one at the half does not.
  assert.equal(resolveRuler({ point: at(3.5, 0), origin: at(0, 0), links: empty, lengthStep: 1, stepReach: 0.17 }).caught, undefined);
});

test("a join still wins: a corner within reach beats the round number beside it", () => {
  // A corner at 2.97 -- no round number -- and the round three 3 cm away: the corner is what the point lands on.
  const corner = { id: "c", position: at(2.97, 0) };
  const result = resolveRuler({ point: at(2.99, 0.02), origin: at(0, 0), links: { points: [corner], runs: [], levels: [] }, lengthStep: 1, stepReach: 0.17, reach: 0.1 });
  assert.equal(result.caught, "point");
  near(result.position.x, 2.97);
});

test("the round number holds a little past its reach once caught, so it does not flicker", () => {
  const first = resolveRuler({ point: at(3.06, 0), origin: at(0, 0), links: empty, lengthStep: 1, stepReach: 0.17 });
  assert.equal(first.caught, "step");
  // 0.14 off: beyond the reach of 0.17 held to 0.4 of a step -- no wait: held to a share, 0.4; reach 0.17 and hold 1.6x.
  const held = resolveRuler({ point: at(3.2, 0), origin: at(0, 0), links: empty, lengthStep: 1, stepReach: 0.17, holding: first.key });
  assert.equal(held.caught, "step", "held past the reach that took it");
  assert.equal(resolveRuler({ point: at(3.2, 0), origin: at(0, 0), links: empty, lengthStep: 1, stepReach: 0.17 }).caught, undefined, "not held: out of reach");
});

test("the facade rounds a value as strongly: 2.91 is three when the step is a quarter, from a good way off", () => {
  const ctx = (extra) => ({ runtime: { getAllRegionTopologies: () => [] }, rulerSnap: true, rulerLengthStep: 0.25, rulerMetersPerPixel: 0.007, ...extra });
  near(rulerOf(ctx()).round(2.91), 3);
  near(rulerOf(ctx()).round(2.97), 3);
  near(rulerOf(ctx()).round(3.12), 3.12, "between two: free");
  near(rulerOf(ctx({ rulerSnap: false })).round(2.91), 2.91, "Ctrl places freely");
  // A lift lands on a round number from as far, too.
  const lifted = rulerOf(ctx()).lift({ dragged: at(0, 0, 3.4), standing: 2.91, base: 0, rounds: true });
  near(lifted.y, 3.4 + 0.09, "the structure goes to 3.0 and the handle with it");
});
