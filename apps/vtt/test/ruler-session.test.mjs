import assert from "node:assert/strict";
import test from "node:test";
import { createRulerSession, rulePointFor, NO_FEEDBACK } from "../src/composition/tabletop/tools/core/ruler-session.ts";
import { RULER_PREVIEW_CHANNEL, rulerLabels, rulerPreview, teethSpacing } from "../src/composition/tabletop/tools/core/ruler-preview.ts";
import { pointerAtHeight } from "../src/composition/tabletop/tools/core/pointer-ray.ts";
import { snapToOutlines } from "../src/features/edit-construction/index.ts";
import { collectLinks } from "../src/features/edit-construction/ruler/index.ts";

const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message ?? ""} ${a} != ${b}`);
const at = (x, z, y = 0) => ({ x, y, z });
const floor = {
  surfaceKey: ["floor", "a"],
  surfaceType: "platform",
  nodes: [{ id: "n1", position: at(0, 0) }, { id: "n2", position: at(4, 0) }, { id: "n3", position: at(4, 3) }, { id: "n4", position: at(0, 3) }],
  outerLoops: [[
    { startNodeId: "n1", endNodeId: "n2", geometry: { kind: "line" } },
    { startNodeId: "n2", endNodeId: "n3", geometry: { kind: "line" } },
    { startNodeId: "n3", endNodeId: "n4", geometry: { kind: "line" } },
    { startNodeId: "n4", endNodeId: "n1", geometry: { kind: "line" } },
  ]],
  holes: [],
};

test("the session reads the table once until it is told something changed", () => {
  let reads = 0;
  const session = createRulerSession(() => { reads += 1; return [floor]; });
  session.rulePoint(at(1, 1), { snap: true });
  session.rulePoint(at(2, 2), { snap: true });
  assert.equal(reads, 1);
  session.invalidate();
  session.rulePoint(at(1, 1), { snap: true });
  assert.equal(reads, 2);
});

test("a sample is ruled onto a corner, and a node handle's is left exactly as it is", () => {
  const session = createRulerSession(() => [floor]);
  const ruled = session.ruleSample({ point: at(4.1, 0.05) }, { snap: true });
  assert.deepEqual(ruled.sample.point, at(4, 0));
  assert.equal(ruled.feedback.guides[0].kind, "point");
  const handle = { nodeId: "h", point: at(4.1, 0.05) };
  assert.deepEqual(session.ruleSample(handle, { snap: true }), { sample: handle, feedback: NO_FEEDBACK });
});

test("with the snap off the sample stays where it was and the guides still say what was near", () => {
  const ruled = createRulerSession(() => [floor]).ruleSample({ point: at(4.1, 0.05) }, { snap: false });
  assert.deepEqual(ruled.sample.point, at(4.1, 0.05));
  assert.equal(ruled.feedback.guides[0].kind, "point");
});

test("a tool ruling a point of its own lines up along its frame's directions", () => {
  const s = Math.SQRT1_2;
  const frame = [{ x: s, z: s }, { x: -s, z: s }];
  const host = { runtime: { getAllRegionTopologies: () => [floor] }, rulerSnap: true };
  // Along the frame's diagonal through the corner (4, 0): (6, 2) is on it, (6.1, 2) is not -- and is pulled onto it.
  const ruled = rulePointFor(host, at(6.1, 2), { axes: frame });
  assert.ok(Math.abs((ruled.x - 4) - (ruled.z - 0)) < 1e-9);
  assert.deepEqual(rulePointFor({ ...host, rulerSnap: false }, at(6.1, 2), { axes: frame }), at(6.1, 2));
});

test("a handle dragged only joins what it lands on when the snap is on; off, it is only told what was near", () => {
  const links = collectLinks([floor], { isGround: () => false });
  const anchors = [{ id: "mine", position: at(8, 0) }];
  const motion = { kind: "line", direction: { x: 1, z: 0 } };
  const on = snapToOutlines(anchors, at(-3.9, 0), motion, links);
  assert.equal(on.joins, true);
  assert.deepEqual(on.magnet, ["n2"]);
  assert.ok(Math.abs(on.delta.x + 4) < 1e-9);
  const off = snapToOutlines(anchors, at(-3.9, 0), motion, links, { snap: false });
  assert.equal(off.joins, false);
  assert.deepEqual(off.magnet, []);
  assert.deepEqual(off.delta, at(-3.9, 0));
  assert.equal(off.guides[0].kind, "point");
});

test("a line-up is not a join: nothing is landed on, so nothing is welded", () => {
  const links = collectLinks([floor], { isGround: () => false });
  const lined = snapToOutlines([{ id: "mine", position: at(10, 7) }], at(0, 0.1), { kind: "free" }, { ...links, runs: [] }, { origin: undefined });
  // Nothing stands near enough to line (10, 7.1) up with.
  assert.equal(lined, undefined);
  const near = snapToOutlines([{ id: "mine", position: at(9, 3.1) }], at(0, 0), { kind: "free" }, { ...links, runs: [] });
  assert.equal(near.joins, false);
  assert.deepEqual(near.magnet, []);
});

test("guides draw as segments on their own channel, and distances read in the table's unit", () => {
  const session = createRulerSession(() => [floor]);
  const { feedback } = session.ruleSample({ point: at(4.1, 0.05) }, { snap: true, origin: at(10, 0) });
  const ghost = rulerPreview(feedback);
  assert.equal(ghost.kind, "segments");
  assert.ok(ghost.positions.length % 6 === 0 && ghost.positions.length > 0);
  assert.equal(RULER_PREVIEW_CHANNEL, "ruler-guides");
  assert.deepEqual(rulerLabels(feedback, "m").find((label) => label.startsWith("6")), "6.00 m");
  assert.ok(rulerLabels(feedback, "ft").some((label) => label.endsWith("ft")));
  assert.equal(rulerPreview(NO_FEEDBACK), undefined);
});

test("labels write every kind of measure in the table's unit, with signs where a change has one", () => {
  const feedback = {
    guides: [{ kind: "angle", origin: at(0, 0), to: at(1, 0), run: [at(0, 0), at(4, 0)], relation: "parallel" }],
    measures: [
      { kind: "height", meters: 3.048, level: 3.048 },
      { kind: "change", name: "lado", meters: -0.3048 },
      { kind: "angle", degrees: -12.34 },
    ],
  };
  const labels = rulerLabels(feedback, "ft");
  // What is catching comes first, then what is measured.
  assert.deepEqual(labels, ["∥ paralelo", "altura 10.0 ft · nível 10.0 ft", "lado −1.0 ft", "∠ −12.3°"]);
  assert.deepEqual(rulerLabels({ guides: [], measures: [{ kind: "change", name: "Δ", meters: 1 }] }, "m"), ["Δ +1.00 m"]);
});

test("a tool that reads the pointer's ray is ruled like one that reads its point -- the ruler is for every tool", () => {
  const camera = at(4, 0, 12), hit = at(4.1, 0.05);
  const d = { x: hit.x - camera.x, y: hit.y - camera.y, z: hit.z - camera.z };
  const n = Math.hypot(d.x, d.y, d.z);
  const raw = { point: hit, ray: { origin: camera, direction: { x: d.x / n, y: d.y / n, z: d.z / n } } };
  const { sample } = createRulerSession(() => [floor]).ruleSample(raw, { snap: true });
  // The point is on the corner, and so is where the ray reads at the ground's height -- for a tool drawing there.
  assert.deepEqual(sample.point, at(4, 0));
  const read = pointerAtHeight(sample, 0);
  assert.ok(Math.abs(read.x - 4) < 1e-6 && Math.abs(read.z) < 1e-6, JSON.stringify(read));
  // Unruled, the ray stays exact: nothing is rounded for a pointer that caught nothing.
  const free = createRulerSession(() => [floor]).ruleSample({ ...raw, point: at(40, 40) }, { snap: true }).sample;
  assert.equal(free.ruled, undefined);
});

test("an angle's label says what it is from, and a square's says it is 90 degrees off an edge", () => {
  const run = [at(0, 0), at(4, 0)];
  const labels = rulerLabels({
    guides: [{ kind: "square", run, from: at(4, 0), to: at(4, 5), relation: "perpendicular" }, { kind: "square", run, from: at(4, 0), to: at(8, 0), relation: "collinear" }],
    measures: [{ kind: "angle", degrees: 12.34, reference: { run, relation: "parallel" } }, { kind: "angle", degrees: 0, reference: { run, relation: "perpendicular" } }],
  }, "m");
  assert.deepEqual(labels, ["⊥ 90° da aresta", "prolonga a aresta", "∠ 12.3° da aresta", "∠ 0.0° do esquadro (90°) da aresta"]);
  // The side an angle is measured from is drawn with the guides.
  const ghost = rulerPreview({ guides: [], measures: [{ kind: "angle", degrees: 5, reference: { run, relation: "parallel" } }] });
  assert.deepEqual([...ghost.positions], [0, 0, 0, 4, 0, 0]);
});

test("each thing the ruler can be on has its own marker, drawn at the size of a few pixels, whatever the zoom", () => {
  const at0 = { x: 5, y: 0, z: 5 };
  const draw = (guide, scale) => rulerPreview({ guides: [guide], measures: [] }, scale).positions;
  const corner = draw({ kind: "point", at: at0, node: "n", role: "corner" }, 0.01);
  const middle = draw({ kind: "point", at: at0, node: "m", role: "midpoint" }, 0.01);
  const cross = draw({ kind: "cross", at: at0 }, 0.01);
  // A square has four sides, a triangle three, a diamond four: told apart by shape.
  assert.equal(corner.length / 6, 4);
  assert.equal(middle.length / 6, 3);
  assert.equal(cross.length / 6, 4);
  assert.notDeepEqual([...corner], [...cross]);
  // Six pixels at a hundredth of a metre a pixel is 0.06 m from the centre: the marker is the same on the screen at any zoom.
  const half = (positions) => Math.max(...positions.filter((_, i) => i % 3 === 0).map((x) => Math.abs(x - at0.x)));
  assert.ok(Math.abs(half(corner) - 0.06) < 1e-6, String(half(corner)));
  const farther = draw({ kind: "point", at: at0, node: "n", role: "corner" }, 0.04);
  assert.ok(Math.abs(half(farther) - 0.24) < 1e-6, "zoomed out, the marker grows in the world to stay as big on the screen");
});

test("labels name what catches before what is measured, each thing said once", () => {
  const corner = { kind: "point", at: at(0, 0), node: "a", role: "corner" };
  const labels = rulerLabels({
    guides: [corner, { kind: "point", at: at(4, 0), node: "b", role: "midpoint" }, { kind: "cross", at: at(1, 1) }, { kind: "align", from: at(0, 0), to: at(5, 0), node: "a" }, { kind: "align", from: at(0, 0), to: at(0, 5), node: "a" }, { kind: "polar", origin: at(0, 0), to: at(3, 3), degrees: 45, from: "world", zero: 0 }, { kind: "polar", origin: at(0, 0), to: at(3, 3), degrees: 30, from: "edge", zero: 0.5 }, { kind: "step", at: at(3, 0), meters: 3 }],
    measures: [{ kind: "length", from: at(0, 0), to: at(3, 0), meters: 3 }],
  }, "m");
  // Which reference an angle counts from is said in the label: the side, or the world.
  assert.deepEqual(labels, ["canto", "meio da aresta", "interseção", "alinhado", "45° do mundo", "30° da aresta", "3.00 m fechado", "3.00 m"]);
});

const lengthOf = (from, to) => ({ kind: "length", from, to, meters: Math.hypot(to.x - from.x, to.z - from.z) });
const segmentsOf = (descriptor) => { if (!descriptor) return []; const p = descriptor.positions, out = []; for (let i = 0; i < p.length; i += 6) out.push([[p[i], p[i + 2]], [p[i + 3], p[i + 5]]]); return out; };

test("the teeth stand at round numbers of the table's unit, finer as it is zoomed in and coarser as it is zoomed out", () => {
  // A tooth needs ten pixels of its own: at a centimetre a pixel that is a tenth of a metre; at a decimetre a pixel, a metre.
  assert.equal(teethSpacing(0.01, "m"), 0.1);
  assert.equal(teethSpacing(0.1, "m"), 1);
  assert.equal(teethSpacing(1, "m"), 10);
  // The same screen, in feet: the teeth are feet.
  assert.ok(Math.abs(teethSpacing(0.01, "ft") - 0.5 * 0.3048) < 1e-9 || Math.abs(teethSpacing(0.01, "ft") - 0.3048) < 1e-9, String(teethSpacing(0.01, "ft")));
  // A round number the table chose is the spacing -- or a multiple of it when that would be a smear.
  assert.equal(teethSpacing(0.01, "m", 1), 1);
  assert.equal(teethSpacing(0.5, "m", 1), 5);
});

test("the teeth are drawn along the line, a tick at every spacing and longer at every fifth, and not on a line shorter than one", () => {
  const view = { unit: "m", lengthStep: 1 };
  const ticks = (to) => segmentsOf(rulerPreview({ guides: [], measures: [lengthOf(at(0, 0), to)] }, 0.01, view));
  // 5.5 m: five teeth, at 1..5 m, each across the line (here square to x).
  const five = ticks(at(5.5, 0));
  assert.equal(five.length, 5);
  five.forEach(([a, b], i) => { near(a[0], i + 1); near(b[0], i + 1); assert.ok(a[1] !== b[1], "across the line"); });
  // The fifth is the longer.
  const reach = ([a, b]) => Math.abs(a[1] - b[1]);
  assert.ok(reach(five[4]) > reach(five[0]) * 1.5);
  assert.equal(ticks(at(0.5, 0)).length, 0, "less than one step: no tooth");
  // Without a view, nothing is drawn but the guides.
  assert.equal(rulerPreview({ guides: [], measures: [lengthOf(at(0, 0), at(5, 0))] }, 0.01), undefined);
});

test("the protractor has a mark every five degrees, longer at the table's step and at the quarter turns, with the zero line", () => {
  const to = at(10 * Math.cos(Math.PI / 6), 10 * Math.sin(Math.PI / 6));
  const view = { unit: "m", angleStep: (15 * Math.PI) / 180, protractor: true };
  const lines = segmentsOf(rulerPreview({ guides: [], measures: [lengthOf(at(0, 0), to)] }, 0.01, view));
  const length = ([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // Radial marks start on the circle of radius 0.7 m (70 px at a centimetre a pixel); the arc between them lies on it.
  const radial = lines.filter(([a, b]) => Math.abs(Math.hypot(a[0], a[1]) - 0.7) < 1e-6 && Math.hypot(b[0], b[1]) > 0.7 + 1e-6);
  // A window of 45 degrees either side of the line, every 5: 19 marks.
  assert.equal(radial.length, 19);
  const longest = Math.max(...radial.map(length)), shortest = Math.min(...radial.map(length));
  assert.ok(longest > shortest * 2, "the quarter turn and the steps stand out from the plain five degrees");
  // The zero line runs from where the line began along the axis the angles count from: the world's x axis, here.
  assert.ok(lines.some(([a, b]) => Math.abs(a[0]) < 1e-9 && Math.abs(a[1]) < 1e-9 && Math.abs(b[1]) < 1e-9 && b[0] > 0.7), "the zero line along x");
  // Not drawn when the table turned the protractor off, nor for a line too short to hold one.
  assert.equal(segmentsOf(rulerPreview({ guides: [], measures: [lengthOf(at(0, 0), to)] }, 0.01, { unit: "m", protractor: false })).filter(([a, b]) => Math.abs(Math.hypot(a[0], a[1]) - 0.7) < 1e-6).length, 0);
});

test("the protractor counts from where the catch says: a side, not the world, when the line follows one", () => {
  const zero = Math.PI / 6;
  const to = at(10 * Math.cos(zero + 0.3), 10 * Math.sin(zero + 0.3));
  const polar = { kind: "polar", origin: at(0, 0), to, degrees: 17, from: "edge", zero };
  const lines = segmentsOf(rulerPreview({ guides: [polar], measures: [lengthOf(at(0, 0), to)] }, 0.01, { unit: "m", protractor: true }));
  // The zero line points along the side: 30 degrees round, not along x.
  const zeroLine = lines.find(([a, b]) => Math.abs(a[0]) < 1e-9 && Math.abs(a[1]) < 1e-9 && Math.abs(Math.hypot(b[0], b[1]) - 0.86) < 1e-6);
  assert.ok(zeroLine, "a zero line");
  near(Math.atan2(zeroLine[1][1], zeroLine[1][0]), zero);
});

test("a round number is marked with a small x where the line ends", () => {
  const lines = segmentsOf(rulerPreview({ guides: [{ kind: "step", at: at(3, 0), meters: 3 }], measures: [] }, 0.01));
  assert.equal(lines.length, 2);
});

test("a drawing never brings a gesture down: a view with no unit named draws its teeth in the default one", () => {
  assert.equal(teethSpacing(0.01, undefined), teethSpacing(0.01, "m"));
  assert.doesNotThrow(() => rulerPreview({ guides: [], measures: [lengthOf(at(0, 0), at(5, 0))] }, 0.01, { unit: undefined, protractor: true }));
});

test("what a road's anchor joined is named and marked as the ruler's own: a node is a square, a span a triangle", () => {
  const node = { kind: "point", at: at(5, 5), node: "n", role: "node" }, span = { kind: "point", at: at(5, 5), node: "e", role: "span" };
  assert.deepEqual(rulerLabels({ guides: [node], measures: [] }, "m"), ["nó da rua"]);
  assert.deepEqual(rulerLabels({ guides: [span], measures: [] }, "m"), ["sobre a rua"]);
  assert.equal(rulerPreview({ guides: [node], measures: [] }, 0.01).positions.length / 6, 4);
  assert.equal(rulerPreview({ guides: [span], measures: [] }, 0.01).positions.length / 6, 3);
});

// The ruler has ONE kind of line. A guide out of a corner, a side it follows, the way to the nearest corner and the line being
// drawn are drawn alike: the line, the teeth counted out from the item, and the protractor round the item.
const view = { unit: "m", lengthStep: 1, angleStep: (15 * Math.PI) / 180, protractor: true };
const teethAt = (descriptor, count) => {
  // A tooth stands across a line along x: both its ends at the same x, one either side of z = 0.
  const found = segmentsOf(descriptor).filter(([a, b]) => Math.abs(a[0] - b[0]) < 1e-9 && a[1] !== b[1] && Math.abs(a[1] + b[1]) < 1e-9 && a[0] > 0.5);
  return count === undefined ? found : found.length;
};
const roundAround = (descriptor, centre, radius) => segmentsOf(descriptor).filter(([a, b]) => Math.abs(Math.hypot(a[0] - centre[0], a[1] - centre[1]) - radius) < 1e-6 && Math.hypot(b[0] - centre[0], b[1] - centre[1]) > radius + 1e-6);

test("a guide that comes out of a corner has the ruler's teeth counted out from the corner, and the protractor round it", () => {
  const guide = { kind: "align", from: at(0, 0), to: at(5, 0), node: "corner" };
  const drawn = rulerPreview({ guides: [guide], measures: [] }, 0.01, view);
  // The line itself, one tooth to each metre out from the corner, and the protractor's marks round the corner.
  assert.ok(segmentsOf(drawn).some(([a, b]) => a[0] === 0 && b[0] === 5 && a[1] === 0 && b[1] === 0), "the line");
  assert.equal(teethAt(drawn, "count"), 5);
  assert.ok(roundAround(drawn, [0, 0], 0.7).length >= 18, "the protractor");
  // Without a view -- no table to count in -- it is the line alone, as before.
  assert.equal(segmentsOf(rulerPreview({ guides: [guide], measures: [] }, 0.01)).length, 1);
});

test("the way to the nearest corner comes out of the corner: teeth from it, protractor round it", () => {
  const gap = { kind: "gap", from: at(3, 0), to: at(0, 0), meters: 3 };
  const drawn = rulerPreview({ guides: [], measures: [gap] }, 0.01, view);
  assert.equal(teethAt(drawn, "count"), 3);
  assert.ok(roundAround(drawn, [0, 0], 0.7).length >= 18, "round the corner, not the pointer");
  assert.equal(roundAround(drawn, [3, 0], 0.7).length, 0);
});

test("a side the ruler follows or is square to is a line like any other: it has its teeth", () => {
  const run = { kind: "run", a: at(0, 0), b: at(4, 0), at: at(2, 0) };
  assert.equal(teethAt(rulerPreview({ guides: [run], measures: [] }, 0.01, view), "count"), 4);
  const square = { kind: "square", run: [at(0, 0), at(4, 0)], from: at(4, 0), to: at(4, 3), relation: "perpendicular" };
  const drawn = rulerPreview({ guides: [square], measures: [] }, 0.01, view);
  // The side (4 teeth along x) and the line out of its end, square to it (3 teeth along z, counted from the end).
  assert.equal(teethAt(drawn, "count"), 4);
  assert.ok(segmentsOf(drawn).filter(([a, b]) => Math.abs(a[1] - b[1]) < 1e-9 && a[1] > 0.5 && Math.abs(a[0] + b[0] - 8) < 1e-5).length === 3, "teeth across the square line");
  // Its protractor counts from the side: the zero line runs along it.
  assert.ok(segmentsOf(drawn).some(([a, b]) => Math.abs(a[0] - 4) < 1e-9 && Math.abs(a[1]) < 1e-9 && Math.abs(Math.hypot(b[0] - 4, b[1]) - 0.86) < 1e-6 && b[1] === 0), "zero along the side");
});

test("every line is drawn once, however many of a feedback's parts name it", () => {
  const run = [at(0, 0), at(4, 0)];
  const lines = segmentsOf(rulerPreview({
    guides: [{ kind: "run", a: run[0], b: run[1], at: at(2, 0) }, { kind: "length", run, meters: 4 }],
    measures: [{ kind: "angle", degrees: 0, reference: { run, relation: "parallel" } }],
  }, 0.01));
  assert.equal(lines.length, 1, "the same side, named three ways, is one line");
});

test("protractors round lines that come out of items are few: the line being drawn always has one, the rest at most two", () => {
  const rays = [1, 2, 3, 4, 5].map((n) => ({ kind: "align", from: at(0, n * 3), to: at(8, n * 3), node: `c${n}` }));
  const drawn = rulerPreview({ guides: rays, measures: [lengthOf(at(20, 0), at(26, 0))] }, 0.01, view);
  const circles = [[20, 0], ...rays.map((r) => [r.from.x, r.from.z])].map((centre) => roundAround(drawn, centre, 0.7).length);
  assert.ok(circles[0] >= 18, "the line being drawn has its protractor");
  assert.equal(circles.slice(1).filter((count) => count >= 18).length, 2, "and only two of the five lines out of items");
});
