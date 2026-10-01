import assert from "node:assert/strict";
import test from "node:test";
import { MAX_MAP_LABELS, compact, mapLabelsOf } from "../src/composition/tabletop/tools/core/ruler-labels.ts";

const at = (x, z, y = 0) => ({ x, y, z });
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message ?? ""} ${a} != ${b}`);
const lengthOf = (from, to) => ({ kind: "length", from, to, meters: Math.hypot(to.x - from.x, to.z - from.z) });
const texts = (labels) => labels.map((label) => label.text);
const only = { unit: "m", lengthStep: 1, protractor: false };

test("a number is written with no trailing zeros: 5, 0.5, 12.25", () => {
  assert.equal(compact(5), "5");
  assert.equal(compact(0.5), "0.5");
  assert.equal(compact(12.25), "12.25");
  assert.equal(compact(0), "0");
  assert.equal(compact(10), "10");
  assert.equal(compact(7.5), "7.5");
});

test("nothing is written without a view to count in, or when the table turned the numbers off", () => {
  const feedback = { guides: [], measures: [lengthOf(at(0, 0), at(12, 0))] };
  assert.deepEqual(mapLabelsOf(feedback, 0.05, undefined), []);
  assert.deepEqual(mapLabelsOf(feedback, 0.05, { ...only, numbers: false }), []);
  assert.ok(mapLabelsOf(feedback, 0.05, only).length > 0);
});

test("the value at the teeth is written every fifth, counted out from the item, and the line's length along it", () => {
  const labels = mapLabelsOf({ guides: [], measures: [lengthOf(at(0, 0), at(12, 0))] }, 0.05, only);
  assert.deepEqual(texts(labels), ["5", "10", "12.00 m"]);
  // The teeth numbers stand where the teeth do, along the line...
  near(labels[0].position.x, 5);
  near(labels[1].position.x, 10);
  // ...off to one side of it, never on it, all the same side; and the length at its middle.
  assert.ok(labels[0].position.z > 0 && Math.abs(labels[0].position.z - labels[1].position.z) < 1e-9);
  near(labels[2].position.x, 6);
  assert.ok(labels[2].position.z > labels[0].position.z, "the length stands a little further out than the teeth numbers");
  // They are the same few pixels tall at any zoom: thirteen of them.
  near(labels[0].height, 13 * 0.05);
});

test("numbers are spaced by the screen: zoomed out, they come further apart so they never run together", () => {
  // A centimetre-a-pixel screen, then a half-metre-a-pixel one, along a long line.
  const near1 = mapLabelsOf({ guides: [], measures: [lengthOf(at(0, 0), at(30, 0))] }, 0.5, only);
  // Teeth of 5 m (a tooth needs ten pixels), a number every 5 of them: 25 m -- not 5, which would be ten pixels apart.
  assert.deepEqual(texts(near1).filter((text) => !text.includes("m")), ["25"]);
  const closer = mapLabelsOf({ guides: [], measures: [lengthOf(at(0, 0), at(30, 0))] }, 0.05, only);
  assert.deepEqual(texts(closer).filter((text) => !text.includes("m")), ["5", "10", "15", "20", "25", "30"]);
});

test("the numbers are in the table's unit", () => {
  // 3.048 m is ten feet; the teeth of half a foot, numbered every fifth: 2.5, 5, 7.5, 10 feet.
  const labels = mapLabelsOf({ guides: [], measures: [lengthOf(at(0, 0), at(3.048, 0))] }, 0.01, { unit: "ft", protractor: false });
  assert.deepEqual(texts(labels), ["2.5", "5", "7.5", "10", "10.0 ft"]);
});

test("the protractor's angles are written at the eighths of a turn and at the line itself", () => {
  const to = at(5 * Math.cos(Math.PI / 6), 5 * Math.sin(Math.PI / 6));
  const labels = mapLabelsOf({ guides: [], measures: [lengthOf(at(0, 0), to)] }, 0.01, { unit: "m", protractor: true, angleStep: Math.PI / 12 });
  const angles = texts(labels).filter((text) => text.endsWith("°"));
  // The window runs from -15 to 75 degrees round the line at 30: the marks at 0 and 45, and the line's own 30.
  assert.deepEqual(angles.sort(), ["0°", "30°", "45°"].sort());
  // They stand round the origin, beyond the protractor's marks (0.7 m at ten pixels... seventy pixels a centimetre).
  for (const label of labels.filter((l) => l.text.endsWith("°"))) assert.ok(Math.hypot(label.position.x, label.position.z) > 0.7, `${label.text} outside the marks`);
  // Not written when the table turned the protractor off.
  assert.deepEqual(texts(mapLabelsOf({ guides: [], measures: [lengthOf(at(0, 0), to)] }, 0.01, { unit: "m", protractor: false })).filter((t) => t.endsWith("°")), []);
});

test("angles count from where the line says: a side, not the world", () => {
  const zero = Math.PI / 6;
  const to = at(5 * Math.cos(zero + 0.3), 5 * Math.sin(zero + 0.3));
  const polar = { kind: "polar", origin: at(0, 0), to, degrees: 17, from: "edge", zero };
  const labels = mapLabelsOf({ guides: [polar], measures: [lengthOf(at(0, 0), to)] }, 0.01, { unit: "m", protractor: true });
  // 0.3 rad is 17.2 degrees past the zero: that is the line's own angle.
  assert.ok(texts(labels).includes("17.2°"), texts(labels).join(" "));
});

test("a line out of an item is a line like any other: it has its numbers, its length and -- for the first two -- its angles", () => {
  const guide = (n) => ({ kind: "align", from: at(0, n * 4), to: at(6, n * 4), node: `c${n}` });
  const feedback = { guides: [1, 2, 3, 4].map(guide), measures: [] };
  const labels = mapLabelsOf(feedback, 0.01, { unit: "m", lengthStep: 1, protractor: true });
  // Every one of the four says its length...
  assert.equal(texts(labels).filter((text) => text === "6.00 m").length, 4);
  // ...and only two of them have a protractor, with the 45 degree marks written round it.
  assert.equal(texts(labels).filter((text) => text === "45°").length, 2);
});

test("no more numbers than a ruler can carry, nearest the line being drawn first", () => {
  const feedback = { guides: Array.from({ length: 20 }, (_, n) => ({ kind: "align", from: at(0, n * 3), to: at(40, n * 3), node: `c${n}` })), measures: [lengthOf(at(100, 0), at(104, 0))] };
  const labels = mapLabelsOf(feedback, 0.01, { unit: "m", lengthStep: 1, protractor: true });
  assert.equal(labels.length, MAX_MAP_LABELS);
  // The line being drawn comes first: its own length is among the first written.
  assert.ok(texts(labels).slice(0, 4).includes("4.00 m"));
});

test("a line of no length writes nothing, and a very short one only its length", () => {
  assert.deepEqual(mapLabelsOf({ guides: [], measures: [lengthOf(at(1, 1), at(1, 1))] }, 0.01, only), []);
  const labels = mapLabelsOf({ guides: [], measures: [lengthOf(at(0, 0), at(0.5, 0))] }, 0.01, only);
  assert.deepEqual(texts(labels), ["0.50 m"]);
});
