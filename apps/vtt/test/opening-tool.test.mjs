import assert from "node:assert/strict";
import test from "node:test";
import { enginePort } from "./engine-planar.mjs";

import { openingTool } from "../src/composition/tabletop/tools/openings/opening-tool.ts";
import { sessionFixture } from "./platform-session-fixture.mjs";
import { click } from "./support/opening-harness.mjs";

/** Where a curve runs, asked of the engine -- the same answer the tool builds on. */
function onCurve(geometry, start, end, at) {
  const [answer] = enginePort.queryContours([{ geometry, from: [start.x, start.z], to: [end.x, end.z], question: { kind: "evaluate", at } }]);
  return answer.points;
}

const WINDOW = { openingKind: "window", width: 1, height: 1 };

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

const STRAIGHT = panelTopology("wall-1", { from: { x: 0, z: 0 }, to: { x: 6, z: 0 } });
// Half of a radius-2 circle centred on the origin, three units tall.
const CURVED = panelTopology("wall-arc", { from: { x: 2, z: 0 }, to: { x: -2, z: 0 } }, [0, 0]);

const BEZIER_START = { x: -3, z: 0 };
const BEZIER_END = { x: 3, z: 0 };
const BEZIER_HANDLES = { handle1: [-1, 2], handle2: [1, 2] };
function reverseBezierHandles(handles) {
  return { handle1: handles.handle2, handle2: handles.handle1 };
}

/** One upright panel whose base and top rails are a genuine Bezier curve, not an arc -- the shape a chord-only rail cannot fall back to without placing an opening off the wall entirely. */
function bezierPanelTopology(id, from, to, handles) {
  const nodes = [
    { id: `${id}:b0`, position: { ...from, y: 0 } },
    { id: `${id}:b1`, position: { ...to, y: 0 } },
    { id: `${id}:t1`, position: { ...to, y: 3 } },
    { id: `${id}:t0`, position: { ...from, y: 3 } },
  ];
  const steps = [
    [0, 1, { kind: "bezier", ...handles }],
    [1, 2, { kind: "line" }],
    [2, 3, { kind: "bezier", ...reverseBezierHandles(handles) }],
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

const BEZIER = bezierPanelTopology("wall-bezier", BEZIER_START, BEZIER_END, BEZIER_HANDLES);

/** `topology` registered in a real session, so the tool reads the engine's own host frame. */
function sessionWith(topology) {
  const fixture = sessionFixture();
  openingTool.onCancel(fixture.ctx);
  const [outer] = topology.outerLoops;
  fixture.runtime.addPatch({
    nodes: topology.nodes,
    edges: outer.map((use) => ({ edgeId: use.edgeId, startNodeId: use.startNodeId, endNodeId: use.endNodeId, geometry: use.geometry })),
    regions: [{ regionId: topology.surfaceKey[1], boundary: outer.map((use) => ({ edgeId: use.edgeId, reversed: false })), surfaceType: topology.surfaceType, physical: true }],
  });
  const openings = () => fixture.runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");
  return { ...fixture, openings };
}

test("a click on a wall stands an opening region there, pinned to the wall, with no hole in the wall", () => {
  const { session, ctx, runtime, openings } = sessionWith(STRAIGHT);
  try {
    // y=1 is the clicked bottom: the window runs from 1 to its own height above.
    click(ctx, { point: { x: 3, y: 1, z: 0 } }, WINDOW);

    const [opening] = openings();
    assert.ok(opening, "one opening region");
    assert.equal(opening.physical, false, "you can see and walk through an opening");
    assert.equal(opening.nodes.length, 4);
    for (const node of opening.nodes) {
      assert.ok(node.position.y >= 1 - 1e-6 && node.position.y <= 2 + 1e-6, "sill to lintel");
      assert.ok(node.position.x >= 2.5 - 1e-6 && node.position.x <= 3.5 + 1e-6, "centred on the click");
      assert.ok(Math.abs(node.position.z) < 1e-9, "on the wall, not beside it");
      assert.deepEqual(node.pin.hostSurfaceKey, STRAIGHT.surfaceKey);
    }
    const wall = runtime.getAllRegionTopologies().find((t) => t.surfaceType === "wall-white");
    assert.equal(wall.holes.length, 0, "the wall is cut at mesh time, never given a topological hole");
  } finally { session.free(); }
});

test("the vertical spot clicked sets where the opening stands on the wall", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  try {
    click(ctx, { point: { x: 3, y: 1.7, z: 0 } }, WINDOW);
    const heights = openings()[0].nodes.map((node) => node.position.y).sort((a, b) => a - b);
    assert.ok(Math.abs(heights[0] - 1.7) < 1e-6, `expected sill at the clicked height, got ${heights[0]}`);
    assert.ok(Math.abs(heights[3] - 2.7) < 1e-6, `expected lintel one height above, got ${heights[3]}`);
  } finally { session.free(); }
});

test("a click too low or too high for the opening's height still places it, clamped to the nearest spot that fits", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  try {
    click(ctx, { point: { x: 1.5, y: 0, z: 0 } }, WINDOW);
    click(ctx, { point: { x: 4.5, y: 10, z: 0 } }, WINDOW);
    const [low, high] = openings()
      .map((opening) => opening.nodes.map((node) => node.position.y).sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0]);
    assert.ok(Math.abs(low[0] - 0.15) < 1e-6, `clamped to the floor margin, got ${low[0]}`);
    assert.ok(Math.abs(high[3] - 2.85) < 1e-6, `clamped to the lintel margin, got ${high[3]}`);
  } finally { session.free(); }
});

test("an opening on a curved wall sits on the curve, every node of it", () => {
  const { session, ctx, openings } = sessionWith(CURVED);
  try {
    // The renderer picked the panel itself, the only exact answer on a curve:
    // the straight line between its two ends runs through open air.
    click(ctx, { point: { x: 0, y: 1, z: 2 }, surfaceRef: "@region,wall-arc" }, WINDOW);
    const [opening] = openings();
    assert.ok(opening, "a curved wall takes an opening like any other");
    assert.equal(opening.nodes.length, 4, "four corners -- no nodes added along the curve");
    for (const node of opening.nodes) {
      assert.ok(Math.abs(Math.hypot(node.position.x, node.position.z) - 2) < 1e-3, `node left the wall: ${JSON.stringify(node.position)}`);
    }
    const traced = opening.outerLoops[0].flatMap((edge) => edge.hostCurve.points);
    assert.ok(opening.outerLoops[0].some((edge) => edge.hostCurve.points.length > 2), "its horizontal sides follow the curve, not one chord");
    for (const [x, , z] of traced) assert.ok(Math.abs(Math.hypot(x, z) - 2) < 1e-3, `traced side left the wall: ${[x, z]}`);
  } finally { session.free(); }
});

test("an opening on a Bezier wall has every node on the wall's own curve", () => {
  const { session, ctx, openings } = sessionWith(BEZIER);
  try {
    const [[midX, midZ]] = onCurve({ kind: "bezier", ...BEZIER_HANDLES }, BEZIER_START, BEZIER_END, [0.5]);
    click(ctx, { point: { x: midX, y: 1, z: midZ }, surfaceRef: "@region,wall-bezier" }, WINDOW);
    const [opening] = openings();
    assert.ok(opening, "a Bezier wall takes an opening like any other");
    assert.equal(opening.nodes.length, 4, "four corners -- no nodes added along the curve");
    assert.ok(opening.outerLoops[0].some((edge) => edge.hostCurve.points.length > 2), "its horizontal sides follow the curve, not one chord");
    const rail = onCurve({ kind: "bezier", ...BEZIER_HANDLES }, BEZIER_START, BEZIER_END, Array.from({ length: 2001 }, (_, step) => step / 2000));
    const traced = opening.outerLoops[0].flatMap((edge) => edge.hostCurve.points.map(([x, y, z]) => ({ x, y, z })));
    for (const point of [...opening.nodes.map((node) => node.position), ...traced]) {
      let closest = Infinity;
      for (const [ox, oz] of rail) closest = Math.min(closest, Math.hypot(point.x - ox, point.z - oz));
      assert.ok(closest < 5e-3, `off the curve by ${closest}`);
    }
  } finally { session.free(); }
});

test("an opening taller than the wall is refused rather than half-built", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  try {
    click(ctx, { point: { x: 3, y: 0, z: 0 } }, { ...WINDOW, height: 5 });
    assert.equal(openings().length, 0, "nothing is registered when it cannot fit");
  } finally { session.free(); }
});

test("a click on open ground opens nothing", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  try {
    click(ctx, { point: { x: 3, y: 0, z: 9 } }, WINDOW);
    assert.equal(openings().length, 0);
  } finally { session.free(); }
});

test("a door sits on the floor of the wall it opens", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  try {
    click(ctx, { point: { x: 3, y: 0, z: 0 } }, { openingKind: "door", width: 1, height: 2 });
    const [opening] = openings();
    assert.deepEqual(opening.nodes.map((node) => node.position.y).sort((a, b) => a - b), [0, 0, 2, 2]);
    assert.ok(opening.nodes.filter((node) => node.position.y === 0).every((node) => node.pin.v === 0), "pinned at the very bottom of the face");
  } finally { session.free(); }
});

test("the hover preview on a slanted-top wall shows the opening deformed by the local height", () => {
  const { session, ctx, runtime } = sessionWith(STRAIGHT);
  try {
    runtime.applyRegionEdit([{ kind: "move-vertex", nodeId: "wall-1:t0", position: { x: 0, y: 1.5, z: 0 } }]);
    const point = { x: 3, y: 0.5, z: 0 };
    const preview = openingTool.previewFor({ start: { point }, current: { point }, samples: [{ point }] }, WINDOW, ctx);
    assert.equal(preview.kind, "segments");
    const vertices = [];
    for (let index = 0; index < preview.positions.length; index += 3) vertices.push([preview.positions[index], preview.positions[index + 1]]);
    const left = Math.min(...vertices.map(([vx]) => vx));
    const right = Math.max(...vertices.map(([vx]) => vx));
    const topAt = (x) => Math.max(...vertices.filter(([vx]) => Math.abs(vx - x) < 1e-4).map(([, vy]) => vy));
    assert.ok(topAt(right) - topAt(left) > 1e-3, `the lintel follows the slanted top: ${topAt(left)} vs ${topAt(right)}`);
  } finally { session.free(); }
});

test("an opening measures itself as it is placed: how wide, how high, and how high its sill stands above the wall's foot", () => {
  const { session, ctx } = sessionWith(STRAIGHT);
  const shown = [];
  ctx.showRuler = (feedback) => shown.push(feedback);
  try {
    const point = { x: 3, y: 0.5, z: 0 };
    const params = { openingKind: "window", width: 1.5, height: 1.2 };
    openingTool.previewFor({ start: { point }, current: { point }, samples: [{ point }] }, params, ctx);
    const measures = shown.filter(Boolean).at(-1).measures;
    const size = (name) => measures.find((m) => m.kind === "size" && m.name === name)?.meters;
    assert.ok(Math.abs(size("largura") - 1.5) < 1e-6, JSON.stringify(measures));
    assert.ok(Math.abs(size("altura") - 1.2) < 1e-6, JSON.stringify(measures));
    // It stands on the height the pointer is at: its sill, above the foot.
    assert.ok(size("peitoril") > 0.4 && size("peitoril") < 0.6, JSON.stringify(measures));
    // A door stands on the floor: no sill to say.
    openingTool.previewFor({ start: { point }, current: { point }, samples: [{ point }] }, { openingKind: "door", width: 1, height: 2 }, ctx);
    assert.equal(shown.filter(Boolean).at(-1).measures.find((m) => m.name === "peitoril"), undefined);
  } finally { session.free(); }
});

/** The box an opening's nodes make on the wall: how far along it, and how high. */
function boxOf(opening) {
  const xs = opening.nodes.map((n) => n.position.x), ys = opening.nodes.map((n) => n.position.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
const nearBy = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message ?? ""} ${a} != ${b}`);
const SMALL = { openingKind: "window", width: 1, height: 0.6 };

test("an opening placed near the height of another is lined up with it, and so is one whose sill is off by a hair", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  ctx.rulerSnap = true;
  try {
    click(ctx, { point: { x: 1.5, y: 1, z: 0 } }, SMALL);
    // The pointer is 8 cm above the first one's sill: well within the ruler's reach.
    const [first] = openings();
    click(ctx, { point: { x: 4.5, y: boxOf(first).y0 + 0.08, z: 0 } }, SMALL);
    const [a, b] = openings().map(boxOf);
    nearBy(b.y0, a.y0, "the second sill is the first's");
    nearBy(b.y1, a.y1);
  } finally { session.free(); }
});

test("an opening dragged near the middle of another is lined up with it -- centre on centre", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  ctx.rulerSnap = true;
  try {
    click(ctx, { point: { x: 1.5, y: 0.5, z: 0 } }, SMALL);
    // Higher up the same wall, 10 cm off the first one's middle.
    click(ctx, { point: { x: 1.6, y: 1.8, z: 0 } }, SMALL);
    const [a, b] = openings().map(boxOf);
    nearBy((b.x0 + b.x1) / 2, (a.x0 + a.x1) / 2, "same centre along the wall");
  } finally { session.free(); }
});

test("an opening between two others is centred in the room left: the same gap on both sides", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  ctx.rulerSnap = true;
  try {
    click(ctx, { point: { x: 1.5, y: 1, z: 0 } }, SMALL);
    click(ctx, { point: { x: 4.5, y: 2, z: 0 } }, SMALL);
    // The room between them is 2..4; 9 cm off its middle.
    click(ctx, { point: { x: 3.09, y: 1.5, z: 0 } }, SMALL);
    const boxes = openings().map(boxOf).sort((p, q) => p.x0 - q.x0);
    const [left, mid, right] = boxes;
    nearBy(mid.x0 - left.x1, right.x0 - mid.x1, "equal gaps either side");
  } finally { session.free(); }
});

test("with the ruler's snap off (Ctrl held) the opening stays exactly where it was put, whatever stands near", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  ctx.rulerSnap = false;
  try {
    click(ctx, { point: { x: 1.5, y: 0.5, z: 0 } }, SMALL);
    click(ctx, { point: { x: 1.6, y: 1.8, z: 0 } }, SMALL);
    const [a, b] = openings().map(boxOf);
    assert.ok(Math.abs((b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2) > 0.05, "no pull toward the neighbour");
  } finally { session.free(); }
});

test("the opening says what it lines up with, and the room it has on either side, in the ruler", () => {
  const { session, ctx, openings } = sessionWith(STRAIGHT);
  ctx.rulerSnap = true;
  const shown = [];
  ctx.showRuler = (feedback) => shown.push(feedback);
  try {
    click(ctx, { point: { x: 1.5, y: 0.5, z: 0 } }, SMALL);
    shown.length = 0;
    const point = { x: 1.6, y: 1.8, z: 0 };
    openingTool.previewFor({ start: { point }, current: { point }, samples: [{ point }] }, SMALL, ctx);
    const feedback = shown.filter(Boolean).at(-1);
    assert.ok(feedback.guides.some((g) => g.kind === "align"), JSON.stringify(feedback.guides));
    const size = (name) => feedback.measures.find((m) => m.kind === "size" && m.name === name)?.meters;
    // Centred on the first one (1..2): 1 from the wall's start, 3 to its end.
    assert.ok(size("à esquerda") !== undefined && size("à direita") !== undefined, JSON.stringify(feedback.measures));
    assert.ok(Math.abs(size("à esquerda") - 1) < 1e-6 || size("à esquerda") > 0, "a gap to the left");
  } finally { session.free(); }
});
