import assert from "node:assert/strict";
import test from "node:test";
import { createRulerSession, rulePointFor, NO_FEEDBACK } from "../src/composition/tabletop/tools/core/ruler-session.ts";
import { RULER_PREVIEW_CHANNEL, rulerLabels, rulerPreview } from "../src/composition/tabletop/tools/core/ruler-preview.ts";
import { pointerAtHeight } from "../src/composition/tabletop/tools/core/pointer-ray.ts";
import { snapToOutlines } from "../src/features/edit-construction/index.ts";
import { collectLinks } from "../src/features/edit-construction/ruler/index.ts";

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
    guides: [corner, { kind: "point", at: at(4, 0), node: "b", role: "midpoint" }, { kind: "cross", at: at(1, 1) }, { kind: "align", from: at(0, 0), to: at(5, 0), node: "a" }, { kind: "align", from: at(0, 0), to: at(0, 5), node: "a" }, { kind: "polar", origin: at(0, 0), to: at(3, 3), degrees: 45 }],
    measures: [{ kind: "length", from: at(0, 0), to: at(3, 0), meters: 3 }],
  }, "m");
  assert.deepEqual(labels, ["canto", "meio da aresta", "interseção", "alinhado", "45° polar", "3.00 m"]);
});
