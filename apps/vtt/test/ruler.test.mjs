import assert from "node:assert/strict";
import test from "node:test";
import { ANGLE_STEPS, DEFAULT_RULER_SETTINGS, LENGTH_STEPS, parseRulerSettings, roundWithin, serializeRulerSettings, baseHeight, catchOnAxis, dimensionsOf, collectLinks, gapCenter, gapsAround, holdsOnAxis, formatLength, measuresOfEdit, fromMetres, resolveLevel, resolveRuler, toMetres } from "../src/features/edit-construction/ruler/index.ts";

const at = (x, z, y = 0) => ({ x, y, z });
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} != ${expected}`);

const square = {
  surfaceKey: ["floor", "a"],
  surfaceType: "platform",
  nodes: [
    { id: "n1", position: at(0, 0) },
    { id: "n2", position: at(4, 0) },
    { id: "n3", position: at(4, 3, 2) },
    { id: "n4", position: at(0, 3) },
  ],
  outerLoops: [[
    { startNodeId: "n1", endNodeId: "n2", geometry: { kind: "line" } },
    { startNodeId: "n2", endNodeId: "n3", geometry: { kind: "line" } },
    { startNodeId: "n3", endNodeId: "n4", geometry: { kind: "line" } },
    { startNodeId: "n4", endNodeId: "n1", geometry: { kind: "line" } },
  ]],
  holes: [],
};
const ground = { ...square, surfaceKey: ["ground", "g"], surfaceType: "terrain" };
const links = collectLinks([square, ground], { isGround: (type) => type === "terrain" });

test("links come from geometry and leave the ground out", () => {
  assert.equal(links.points.length, 4);
  // The sides at n3, which stands at 2, climb, so they are no level runs.
  assert.equal(links.runs.length, 2);
  assert.deepEqual(links.levels, [0, 2]);
  assert.equal(collectLinks([square], { isGround: () => false, skip: new Set(["floor\u0000a"]) }).points.length, 0);
});

test("a corner within reach is taken, and beats a side", () => {
  const result = resolveRuler({ point: at(4.1, 0.05), links });
  assert.equal(result.caught, "point");
  near(result.position.x, 4);
  near(result.position.z, 0);
});

test("a side within reach is landed on", () => {
  // Off the middle and the corners, so only the side itself can catch.
  const result = resolveRuler({ point: at(1, 0.15), links });
  assert.equal(result.caught, "run");
  near(result.position.z, 0);
  near(result.position.x, 1);
});

test("a point in line with a corner is lined up, and both axes cross on one point", () => {
  const one = resolveRuler({ point: at(9.9, 0.1), links: { ...links, runs: [] } });
  assert.equal(one.caught, "align");
  near(one.position.z, 0);
  const corners = [{ id: "a", position: at(0, 10) }, { id: "b", position: at(10, 3) }];
  const both = resolveRuler({ point: at(0.1, 3.1), links: { points: corners, runs: [], levels: [] } });
  assert.equal(both.caught, "intersection");
  assert.equal(both.guides.filter((g) => g.kind === "align").length, 2);
  assert.ok(both.guides.some((g) => g.kind === "cross"), "the crossing is marked");
  near(both.position.x, 0);
  near(both.position.z, 3);
});

test("with the snap off the position stays and the guides still show", () => {
  const result = resolveRuler({ point: at(4.1, 0.05), links, snap: false });
  assert.deepEqual(result.position, at(4.1, 0.05));
  assert.equal(result.caught, "point");
  assert.equal(result.guides.length, 1);
});

test("a line motion only ever moves along its own path", () => {
  const along = { kind: "line", direction: { x: 1, z: 0 } };
  const off = resolveRuler({ point: at(4.1, 0.1), links, motion: along });
  // The corner is not on the path z = 0.1, so it is not taken; the run is met along the path.
  assert.notEqual(off.caught, "point");
  near(off.position.z, 0.1);
  const on = resolveRuler({ point: at(4.1, 0), links, motion: along });
  assert.equal(on.caught, "point");
  near(on.position.x, 4);
});

test("a skipped node is never joined to", () => {
  const result = resolveRuler({ point: at(0.05, 0.05), links, skip: new Set(["n1"]), motion: { kind: "free" } });
  assert.notEqual(result.guides[0]?.node, "n1");
});

test("a length matching a standing run is landed on", () => {
  // Far from every side's direction and from every edge's square, so only the length can catch.
  const result = resolveRuler({ point: at(12.02, 3.5), origin: at(10, 0), links: { points: [], runs: links.runs, levels: [] } });
  assert.equal(result.caught, "length");
  near(Math.hypot(result.position.x - 10, result.position.z), 4);
});

test("a line near a standing side's direction is turned onto it, keeping its length", () => {
  // Drawn on a free line, away from every corner's axis, so only the direction can catch.
  const result = resolveRuler({ point: at(16, 6.15), origin: at(10, 6), links });
  assert.equal(result.caught, "angle");
  near(result.position.z, 6);
  near(result.position.x - 10, Math.hypot(6, 0.15));
  const guide = result.guides.find((g) => g.kind === "angle");
  assert.equal(guide.relation, "parallel");
});

test("square to a standing side counts too, and is named perpendicular", () => {
  // Only the side along x stands near, so running along z is square to it.
  const result = resolveRuler({ point: at(10.1, 6), origin: at(10, 0), links: { ...links, runs: [links.runs[0]] } });
  assert.equal(result.caught, "angle");
  near(result.position.x, 10);
  assert.equal(result.guides.find((g) => g.kind === "angle").relation, "perpendicular");
});

test("a line turned onto a direction can also match a standing length, both holding", () => {
  // Along the side's direction and 4.05 long: the 4 m run matches too.
  const result = resolveRuler({ point: at(14.05, 6.1), origin: at(10, 6), links });
  assert.equal(result.caught, "angle");
  assert.ok(result.guides.some((g) => g.kind === "length"));
  near(Math.hypot(result.position.x - 10, result.position.z - 6), 4);
});

test("the way a line runs is measured from the nearest side, 0 meaning the same way or square to it", () => {
  const result = resolveRuler({ point: at(16, 2), origin: at(10, 0), links, snap: false });
  const angle = result.measures.find((m) => m.kind === "angle");
  near(angle.degrees, (Math.atan2(2, 6) * 180) / Math.PI);
  assert.equal(result.caught, undefined);
});

test("a line that runs far from every direction is not turned", () => {
  const result = resolveRuler({ point: at(14, 4), origin: at(10, 0), links });
  assert.notEqual(result.caught, "angle");
});

test("measures give the length drawn and the gap to the nearest corner", () => {
  const result = resolveRuler({ point: at(6, 0), origin: at(8, 0), links, snap: false });
  const length = result.measures.find((m) => m.kind === "length");
  const gap = result.measures.find((m) => m.kind === "gap");
  near(length.meters, 2);
  near(gap.meters, 2);
});

test("a height lands on a standing level", () => {
  const near2 = resolveLevel(1.9, links, at(0, 0, 1.9));
  assert.equal(near2.y, 2);
  assert.equal(near2.guide.kind, "level");
  assert.equal(resolveLevel(1, links, at(0, 0, 1)).y, 1);
  assert.equal(resolveLevel(1.9, links, at(0, 0, 1.9), { snap: false }).y, 1.9);
});

test("units convert both ways and write themselves", () => {
  near(fromMetres(1.524, "sq"), 1);
  near(toMetres(5, "ft"), 1.524);
  assert.equal(formatLength(3.048, "ft"), "10.0 ft");
  assert.equal(formatLength(3.048), "3.05 m");
});

test("an edit measures the exact size it leaves, not only the change", () => {
  const from = at(0, 0, 3), to = at(0, 0, 4.5);
  const [height, change] = measuresOfEdit({ kind: "height", base: 0 }, from, to);
  assert.deepEqual(height, { kind: "height", meters: 4.5, level: 4.5 });
  assert.deepEqual(change, { kind: "change", name: "Δ", meters: 1.5 });
  // A side pushed out reads along its own direction, signed.
  assert.deepEqual(measuresOfEdit({ kind: "side", direction: { x: 1, z: 0 } }, at(2, 0), at(0.5, 3)), [{ kind: "change", name: "lado", meters: -1.5 }]);
  // A move says how far it went across the ground and how much it went up, and nothing when it did not move.
  const moved = measuresOfEdit({ kind: "move" }, at(0, 0), at(3, 4, 1));
  assert.equal(moved[0].meters, 5);
  assert.deepEqual(moved[1], { kind: "change", name: "Δ altura", meters: 1 });
  assert.deepEqual(measuresOfEdit({ kind: "move" }, at(1, 1), at(1, 1)), []);
  assert.deepEqual(measuresOfEdit({ kind: "turn", angle: Math.PI / 2 }, at(0, 0), at(0, 0)), [{ kind: "angle", degrees: 90, name: "giro" }]);
});

test("the base a structure rises from is its lowest node", () => {
  assert.equal(baseHeight([3, 0.5, 2], 9), 0.5);
  assert.equal(baseHeight([], 9), 9);
});

test("a point square to a side at its end is landed on the 90 degree line, whatever the world's axes say", () => {
  // A side running at 30 degrees: its square stands out of its end at 120 degrees -- on no axis of the world.
  const t = Math.PI / 6, d = { x: Math.cos(t), z: Math.sin(t) };
  const a = { id: "a", position: at(0, 0) }, b = { id: "b", position: at(10 * d.x, 10 * d.z) };
  const edge = { points: [a, b], runs: [{ a, b }], levels: [] };
  // 6 along the square from the end b, a hair off it.
  const out = { x: b.position.x - d.z * 6, z: b.position.z + d.x * 6 };
  const result = resolveRuler({ point: at(out.x + d.x * 0.1, out.z + d.z * 0.1), links: edge });
  assert.equal(result.caught, "square");
  const guide = result.guides.find((g) => g.kind === "square");
  assert.equal(guide.relation, "perpendicular");
  near(result.position.x, out.x);
  near(result.position.z, out.z);
});

test("a point in line with a side, beyond its end, is landed on its extension", () => {
  const result = resolveRuler({ point: at(6.1, 0.15), links });
  assert.equal(result.caught, "square");
  assert.equal(result.guides.find((g) => g.kind === "square").relation, "collinear");
  near(result.position.z, 0);
});

test("an angle names the side it is measured from, and whether it is from its direction or its square", () => {
  const along = resolveRuler({ point: at(16, 2), origin: at(10, 0), links, snap: false }).measures.find((m) => m.kind === "angle");
  assert.equal(along.reference.relation, "parallel");
  assert.equal(along.reference.run.length, 2);
  const across = resolveRuler({ point: at(10.5, 6), origin: at(10, 0), links: { ...links, runs: [links.runs[0]] }, snap: false }).measures.find((m) => m.kind === "angle");
  assert.equal(across.reference.relation, "perpendicular");
});

const edge = (value) => ({ value, part: "edge" });
const center = (value) => ({ value, part: "center" });

test("along a line, a box's edge lands flush on another edge, and its centre on a centre", () => {
  const flush = catchOnAxis(1.05, 2.05, "both", [edge(2), center(9)], 0.1);
  assert.equal(flush.part, "end");
  near(flush.shift, -0.05);
  const centred = catchOnAxis(1, 2, "both", [center(1.6)], 0.2);
  assert.equal(centred.part, "center");
  near(centred.shift, 0.1);
  // An edge never lines up with a centre, nor a centre with an edge.
  assert.equal(catchOnAxis(1, 2, "both", [center(2.02), edge(1.5)], 0.1), undefined);
  assert.equal(catchOnAxis(1, 2, "both", [edge(5)], 0.1), undefined);
});

test("only the edge that moves lines up; a held box catches nothing", () => {
  const targets = [edge(1), edge(2.05)];
  assert.equal(catchOnAxis(1, 2, "end", targets, 0.1).part, "end");
  assert.equal(catchOnAxis(1, 2, "start", targets, 0.1).part, "start");
  assert.equal(catchOnAxis(1, 2, "none", targets, 0.1), undefined);
});

test("flush beats centred when both are equally near", () => {
  const caught = catchOnAxis(0, 2, "both", [center(1.1), edge(0.1)], 0.2);
  assert.equal(caught.target.part, "edge");
});

test("a box is centred in the room between what stands on either side", () => {
  // Bounds at 2 and 4 around a box 1 wide near 3.1: the middle of that room is 3.
  near(gapCenter(2.6, 3.6, [[1, 2], [4, 5]], [0, 6]), 3);
  // The line's own ends count: nothing else stands, so the middle of the whole line.
  near(gapCenter(0.5, 1.5, [], [0, 6]), 3);
  // A room too small for the box gives no middle.
  assert.equal(gapCenter(2.1, 3.1, [[1, 2], [2.9, 5]], [0, 6]), undefined);
});

test("the room on either side of a box is measured to what stands, or to the line's end", () => {
  const room = gapsAround(2.5, 3.5, [[1, 2], [4.5, 5]], [0, 6]);
  near(room.before, 0.5);
  near(room.after, 1);
  const open = gapsAround(2.5, 3.5, [], [0, 6]);
  near(open.before, 2.5);
  near(open.after, 2.5);
});

test("the line-ups that already hold are the ones to draw", () => {
  const held = holdsOnAxis(1, 2, [edge(2), center(1.5), edge(3), center(9)]);
  assert.deepEqual(held.map((h) => h.part).sort(), ["center", "end"]);
});

test("the middle of a side catches, is not a node to join, and loses a tie to a corner", () => {
  const result = resolveRuler({ point: at(2.1, 0.1), links });
  assert.equal(result.caught, "point");
  const guide = result.guides.find((g) => g.kind === "point");
  assert.equal(guide.role, "midpoint");
  near(result.position.x, 2);
  near(result.position.z, 0);
  // A corner as near as a middle wins.
  const tie = resolveRuler({ point: at(0.05, 0.05), links });
  assert.equal(tie.guides.find((g) => g.kind === "point").role, "corner");
});

test("a point square to one edge and in line with another's corner lands on where they cross", () => {
  // Square out of the end of the 0..10 side at x = 10, and in line with a corner at z = 6.
  const a = { id: "a", position: at(0, 0) }, b = { id: "b", position: at(10, 0) }, c = { id: "c", position: at(30, 6) };
  const world = { points: [a, b, c], runs: [{ a, b }], levels: [] };
  const result = resolveRuler({ point: at(10.1, 6.08), links: world });
  assert.equal(result.caught, "intersection");
  near(result.position.x, 10);
  near(result.position.z, 6);
  assert.ok(result.guides.some((g) => g.kind === "square") && result.guides.some((g) => g.kind === "align"));
});

test("a catch already held stays on past the reach, up to the hold factor, and is let go beyond", () => {
  const world = { points: [{ id: "c", position: at(0, 0) }], runs: [], levels: [] };
  // Only the corner is asked about: a point on a corner's axis would rightly catch a line-up too.
  const only = new Set(["align", "square", "intersection", "midpoint"]);
  const near1 = resolveRuler({ point: at(0.2, 0), links: world, disabled: only, reach: 0.1 });
  assert.equal(near1.caught, undefined, "out of reach on the first approach");
  const first = resolveRuler({ point: at(0.08, 0), links: world, disabled: only, reach: 0.1 });
  assert.equal(first.caught, "point");
  // Drifting out: past the reach, but inside the held reach, it stays.
  const held = resolveRuler({ point: at(0.14, 0), links: world, disabled: only, reach: 0.1, holding: first.key });
  assert.equal(held.caught, "point");
  near(held.position.x, 0);
  // Well beyond, it lets go.
  assert.equal(resolveRuler({ point: at(0.3, 0), links: world, disabled: only, reach: 0.1, holding: first.key }).caught, undefined);
  // Held only by its own name: another corner does not borrow the wider reach.
  assert.equal(resolveRuler({ point: at(0.14, 0), links: world, disabled: only, reach: 0.1, holding: "corner:other" }).caught, undefined);
});

test("polar tracking catches the steps from where the line began, keeping its length", () => {
  const empty = { points: [], runs: [], levels: [] };
  const step = Math.PI / 4;
  // 44 degrees off the x axis, 10 long: the 45 degree step is within three degrees.
  const heading = (44 * Math.PI) / 180;
  const result = resolveRuler({ point: at(10 * Math.cos(heading), 10 * Math.sin(heading)), origin: at(0, 0), links: empty, polar: step });
  assert.equal(result.caught, "polar");
  near(Math.hypot(result.position.x, result.position.z), 10);
  near(Math.atan2(result.position.z, result.position.x), step);
  assert.equal(result.guides.find((g) => g.kind === "polar").degrees.toFixed(0), "45");
  // 20 degrees is on no step.
  const off = (20 * Math.PI) / 180;
  assert.equal(resolveRuler({ point: at(10 * Math.cos(off), 10 * Math.sin(off)), origin: at(0, 0), links: empty, polar: step }).caught, undefined);
  // Without steps asked for, nothing is tracked.
  assert.equal(resolveRuler({ point: at(10 * Math.cos(heading), 10 * Math.sin(heading)), origin: at(0, 0), links: empty }).caught, undefined);
});

test("the ways of catching the table left out do not catch, and the rest still do", () => {
  const off = (kinds) => new Set(kinds);
  assert.equal(resolveRuler({ point: at(4.1, 0.05), links, disabled: off(["corner", "midpoint"]) }).guides.some((g) => g.kind === "point"), false);
  // Without corners the point is still on the side it is near.
  assert.equal(resolveRuler({ point: at(1, 0.1), links, disabled: off(["side"]) }).caught !== "run", true);
  assert.equal(resolveRuler({ point: at(6.1, 0.15), links, disabled: off(["square"]) }).caught !== "square", true);
  const heading = (44 * Math.PI) / 180;
  const empty = { points: [], runs: [], levels: [] };
  assert.equal(resolveRuler({ point: at(10 * Math.cos(heading), 10 * Math.sin(heading)), origin: at(0, 0), links: empty, polar: Math.PI / 4, disabled: off(["polar"]) }).caught, undefined);
  assert.equal(resolveLevel(1.9, links, at(0, 0, 1.9), { disabled: off(["level"]) }).y, 1.9);
});

test("only what is near is offered a line: a corner far from the pointer draws no guide", () => {
  const far = { id: "far", position: at(100, 0) };
  const world = { points: [far], runs: [], levels: [] };
  // In line with a corner 100 away, but it is not acquired.
  assert.equal(resolveRuler({ point: at(0, 0.1), links: world, acquire: 5 }).caught, undefined);
  // Left unlimited, it would be.
  assert.equal(resolveRuler({ point: at(0, 0.1), links: world }).caught, "align");
});

test("a structure says how big it is without being touched: its length and depth along its own run, and its height", () => {
  // The floor of the tests above leans: n3 stands 2 high, the rest at the ground.
  const sizes = Object.fromEntries(dimensionsOf([square]).map((m) => [m.name, m.meters]));
  near(sizes.comprimento, 4);
  near(sizes.profundidade, 3);
  near(sizes.altura, 2);
});

test("a thin wall has no depth to speak of, and a flat floor no height", () => {
  const wall = { ...square, nodes: [
    { id: "w1", position: at(0, 0, 0) }, { id: "w2", position: at(6, 0, 0) }, { id: "w3", position: at(6, 0, 3) }, { id: "w4", position: at(0, 0, 3) },
  ], outerLoops: [[
    { startNodeId: "w1", endNodeId: "w2", geometry: { kind: "line" } }, { startNodeId: "w2", endNodeId: "w3", geometry: { kind: "line" } },
    { startNodeId: "w3", endNodeId: "w4", geometry: { kind: "line" } }, { startNodeId: "w4", endNodeId: "w1", geometry: { kind: "line" } },
  ]] };
  const sizes = Object.fromEntries(dimensionsOf([wall]).map((m) => [m.name, m.meters]));
  near(sizes.comprimento, 6);
  near(sizes.altura, 3);
  assert.equal(sizes.profundidade, undefined);
  const flat = Object.fromEntries(dimensionsOf([{ ...square, nodes: square.nodes.map((n) => ({ ...n, position: { ...n.position, y: 1 } })) }]).map((m) => [m.name, m.meters]));
  assert.equal(flat.altura, undefined);
  assert.deepEqual(dimensionsOf([]), []);
});

const deg = (n) => (n * Math.PI) / 180;
const empty = { points: [], runs: [], levels: [] };

test("the protractor counts from the nearest side: 0 is along it, and 90 square to it, in steps of five degrees", () => {
  // One side runs 30 degrees off the world's x axis; the line starts beside it.
  const a = { id: "a", position: at(0, 0) }, b = { id: "b", position: at(10 * Math.cos(deg(30)), 10 * Math.sin(deg(30))) };
  const edge = { points: [a, b], runs: [{ a, b }], levels: [] };
  const origin = at(3, 2);
  // 30 + 40 = 70 degrees from the world, 40 from the side: a step of 5 -- but 41.2 is not near one.
  const aim = (fromSide, length = 6) => ({ x: origin.x + length * Math.cos(deg(30 + fromSide)), z: origin.z + length * Math.sin(deg(30 + fromSide)) });
  const on40 = resolveRuler({ point: at(aim(40.4).x, aim(40.4).z), origin, links: edge, polar: deg(5), disabled: new Set(["angle"]) });
  assert.equal(on40.caught, "polar");
  assert.equal(on40.guides.find((g) => g.kind === "polar").from, "edge");
  near(Math.atan2(on40.position.z - origin.z, on40.position.x - origin.x), deg(70));
  near(Math.hypot(on40.position.x - origin.x, on40.position.z - origin.z), 6);
  // Its degrees are from the side, not the world.
  near(on40.guides.find((g) => g.kind === "polar").degrees, 40);
  // With no side near, it counts from the world.
  const world = resolveRuler({ point: at(6 * Math.cos(deg(40.4)), 6 * Math.sin(deg(40.4))), origin: at(0, 0), links: empty, polar: deg(5) });
  assert.equal(world.guides.find((g) => g.kind === "polar").from, "world");
  near(Math.atan2(world.position.z, world.position.x), deg(40));
});

test("a finer step catches more steps: five degrees offers what fifteen does not", () => {
  const point = at(10 * Math.cos(deg(20.2)), 10 * Math.sin(deg(20.2)));
  assert.equal(resolveRuler({ point, origin: at(0, 0), links: empty, polar: deg(15) }).caught, undefined, "20 is no step of 15");
  assert.equal(resolveRuler({ point, origin: at(0, 0), links: empty, polar: deg(5) }).caught, "polar", "but it is one of 5");
});

test("the angle's reach is a few pixels seen from the line's end: a long line is held to a finer angle than a short one", () => {
  // The same 3 degrees off the 15 degree step: caught at 2 m, not at 20 m.
  const off = deg(15 + 3);
  const at2 = resolveRuler({ point: at(2 * Math.cos(off), 2 * Math.sin(off)), origin: at(0, 0), links: empty, polar: deg(15), reach: 0.2 });
  const at20 = resolveRuler({ point: at(20 * Math.cos(off), 20 * Math.sin(off)), origin: at(0, 0), links: empty, polar: deg(15), reach: 0.2 });
  assert.equal(at2.caught, "polar");
  assert.equal(at20.caught, undefined);
});

test("a length near a round number lands on it, in whole units or whatever step is chosen", () => {
  const near1 = resolveRuler({ point: at(3.07, 0), origin: at(0, 0), links: empty, lengthStep: 1, reach: 0.1 });
  assert.equal(near1.caught, "step");
  near(near1.position.x, 3);
  assert.equal(near1.guides.find((g) => g.kind === "step").meters, 3);
  // Five by five.
  near(resolveRuler({ point: at(9.95, 0), origin: at(0, 0), links: empty, lengthStep: 5, reach: 0.1 }).position.x, 10);
  // Far from a round number it is left alone, and so with no step.
  assert.equal(resolveRuler({ point: at(3.5, 0), origin: at(0, 0), links: empty, lengthStep: 1, reach: 0.1 }).caught, undefined);
  assert.equal(resolveRuler({ point: at(3.07, 0), origin: at(0, 0), links: empty, reach: 0.1 }).caught, undefined);
  // Not zero: a line of no length is nothing to round.
  assert.equal(resolveRuler({ point: at(0.03, 0), origin: at(0, 0), links: empty, lengthStep: 1, reach: 0.1 }).caught, undefined);
});

test("a round length and a direction hold together: the line is on a step of the protractor and a whole number long", () => {
  const heading = deg(44.6);
  const result = resolveRuler({ point: at(5.06 * Math.cos(heading), 5.06 * Math.sin(heading)), origin: at(0, 0), links: empty, polar: deg(15), lengthStep: 1, reach: 0.1 });
  assert.equal(result.caught, "polar");
  near(Math.atan2(result.position.z, result.position.x), deg(45));
  near(Math.hypot(result.position.x, result.position.z), 5);
  assert.ok(result.guides.some((g) => g.kind === "step"));
});

test("a side's length wins a tie against a round number: it is something that stands", () => {
  const a = { id: "a", position: at(0, 0) }, b = { id: "b", position: at(5, 0) };
  const result = resolveRuler({ point: at(25 + 5.04, 0), origin: at(25, 0), links: { points: [a, b], runs: [{ a, b }], levels: [] }, lengthStep: 1, reach: 0.1, disabled: new Set(["align", "square", "intersection", "angle", "polar", "midpoint", "corner"]) });
  assert.equal(result.guides[0].kind, "length", "the side's 5 m, and not the round 5 m beside it");
});

test("a value is rounded to a step only when it is near one", () => {
  near(roundWithin(4.97, 5, 0.1), 5);
  assert.equal(roundWithin(4.5, 5, 0.1), undefined);
  assert.equal(roundWithin(4.97, 0, 0.1), undefined);
  near(roundWithin(2.04, 0.5, 0.1), 2);
});

test("what a table asks of its ruler is read back whole, and an old or odd record reads as far as it can", () => {
  const settings = { disabled: new Set(["polar", "midpoint"]), angleStep: 5, lengthStep: 0.5 };
  const back = parseRulerSettings(JSON.parse(JSON.stringify(serializeRulerSettings(settings))));
  assert.deepEqual([...back.disabled].sort(), ["midpoint", "polar"]);
  assert.equal(back.angleStep, 5);
  assert.equal(back.lengthStep, 0.5);
  // The old form: only the list of what is off.
  assert.deepEqual([...parseRulerSettings(["corner", "nonsense"]).disabled], ["corner"]);
  assert.equal(parseRulerSettings(["corner"]).angleStep, DEFAULT_RULER_SETTINGS.angleStep);
  // Nothing readable, or a step that is not on offer: the default.
  assert.deepEqual(parseRulerSettings(null), DEFAULT_RULER_SETTINGS);
  assert.equal(parseRulerSettings({ angleStep: 7, lengthStep: 3 }).angleStep, DEFAULT_RULER_SETTINGS.angleStep);
  assert.equal(parseRulerSettings({ angleStep: 7, lengthStep: 3 }).lengthStep, DEFAULT_RULER_SETTINGS.lengthStep);
  assert.ok(ANGLE_STEPS.includes(5) && LENGTH_STEPS.includes(0));
  // The numbers on the map are on unless the table turned them off, and the choice is kept.
  assert.equal(parseRulerSettings({}).numbers, true);
  assert.equal(parseRulerSettings(JSON.parse(JSON.stringify(serializeRulerSettings({ ...DEFAULT_RULER_SETTINGS, numbers: false })))).numbers, false);
  assert.equal(parseRulerSettings({ numbers: "no" }).numbers, true, "an unreadable choice is the default");
  assert.equal(parseRulerSettings(["corner"]).numbers, true, "the old form carries none");
});

test("the protractor offers the side and the world at once, and the guide says which one caught", () => {
  // A side 30 degrees off the world's axis, beside the line's start.
  const a = { id: "a", position: at(0, 0) }, b = { id: "b", position: at(10 * Math.cos(deg(30)), 10 * Math.sin(deg(30))) };
  const edge = { points: [a, b], runs: [{ a, b }], levels: [] };
  const origin = at(3, 2);
  const only = new Set(["angle"]);
  const toward = (worldDegrees) => at(origin.x + 6 * Math.cos(deg(worldDegrees)), origin.z + 6 * Math.sin(deg(worldDegrees)));
  // 100.3 from the world is 70.3 from the side, and a step of 5 of both: the side, which comes first, wins the tie.
  const bySide = resolveRuler({ point: toward(100.3), origin, links: edge, polar: deg(5), disabled: only });
  assert.equal(bySide.guides.find((g) => g.kind === "polar").from, "edge");
  // 45.2 from the world's axis is a step of the world's, and is 15.2 from the side: a step of the side's too, so the side's, which comes first, wins a tie.
  const byWorld = resolveRuler({ point: toward(90.2), origin, links: edge, polar: deg(45), disabled: only });
  assert.equal(byWorld.guides.find((g) => g.kind === "polar").from, "world", "90 is a step of the world, and 60 off the side is none of 45");
  // The zero of the count is where the guide says it stands.
  near(bySide.guides.find((g) => g.kind === "polar").zero, deg(30));
  near(byWorld.guides.find((g) => g.kind === "polar").zero, 0);
});
