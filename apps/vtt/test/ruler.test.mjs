import assert from "node:assert/strict";
import test from "node:test";
import { collectLinks, formatLength, fromMetres, resolveLevel, resolveRuler, toMetres } from "../src/features/edit-construction/ruler/index.ts";

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
  const result = resolveRuler({ point: at(14.1, 0.01), origin: at(10, 0), links: { points: [], runs: links.runs, levels: [] } });
  assert.equal(result.caught, "length");
  near(Math.hypot(result.position.x - 10, result.position.z), 4);
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
