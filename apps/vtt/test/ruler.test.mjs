import assert from "node:assert/strict";
import test from "node:test";
import { baseHeight, catchOnAxis, collectLinks, gapCenter, gapsAround, holdsOnAxis, formatLength, measuresOfEdit, fromMetres, resolveLevel, resolveRuler, toMetres } from "../src/features/edit-construction/ruler/index.ts";

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
  const result = resolveRuler({ point: at(2, 0.15), links });
  assert.equal(result.caught, "run");
  near(result.position.z, 0);
  near(result.position.x, 2);
});

test("a point in line with a corner is lined up, and both axes cross on one point", () => {
  const one = resolveRuler({ point: at(9.9, 0.1), links: { ...links, runs: [] } });
  assert.equal(one.caught, "align");
  near(one.position.z, 0);
  const corners = [{ id: "a", position: at(0, 10) }, { id: "b", position: at(10, 3) }];
  const both = resolveRuler({ point: at(0.1, 3.1), links: { points: corners, runs: [], levels: [] } });
  assert.equal(both.guides.length, 2);
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
  const result = resolveRuler({ point: at(16, 6.3), origin: at(10, 6), links });
  assert.equal(result.caught, "angle");
  near(result.position.z, 6);
  near(result.position.x - 10, Math.hypot(6, 0.3));
  const guide = result.guides.find((g) => g.kind === "angle");
  assert.equal(guide.relation, "parallel");
});

test("square to a standing side counts too, and is named perpendicular", () => {
  // Only the side along x stands near, so running along z is square to it.
  const result = resolveRuler({ point: at(10.2, 6), origin: at(10, 0), links: { ...links, runs: [links.runs[0]] } });
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
