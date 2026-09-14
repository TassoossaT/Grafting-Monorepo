import assert from "node:assert/strict";
import test from "node:test";
import { planEdit, readStrips, resolveCloudTopology } from "../src/features/edit-construction/index.ts";
import { platformContourTool } from "../src/composition/tabletop/tools/platform/platform-contour-tool.ts";
import { commitPlatformSlope } from "../src/composition/tabletop/tools/platform/platform-slope.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

const params = { mode: "create", elevation: 0, shape: "slope", width: 2 };
const floor = (runtime, prefix, x0, y) => addFace(runtime, prefix, "platform",
  [[x0, 0], [x0 + 4, 0], [x0 + 4, 4], [x0, 4]].map(([x, z], i) => ({ id: `${prefix}:${i}`, position: { x, y, z } })));
const faces = (runtime, type) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === type);
const floorOf = (runtime, prefix) => faces(runtime, "platform").find((t) => t.nodes.some((n) => n.id === `${prefix}:0`));
const onlyStrip = (runtime) => [...readStrips(faces(runtime, "platform-slope")).values()][0];

function twoFloorsAndRamp() {
  const fixture = sessionFixture();
  floor(fixture.runtime, "low", 0, 0);
  floor(fixture.runtime, "high", 10, 3);
  commitPlatformSlope(fixture.ctx, [{ x: 4, y: 0, z: 2 }, { x: 7, y: 1.2, z: 2.6 }, { x: 10, y: 3, z: 2 }], params);
  return fixture;
}

test("a ramp welds both ends onto the floors it lands on, sharing nodes and its end rungs", () => {
  const { runtime, session, calls } = twoFloorsAndRamp();
  try {
    const strip = onlyStrip(runtime);
    assert.ok(strip, JSON.stringify(calls.feedback));
    assert.ok(strip.length >= 3, "a curved axis should produce interior stations");
    const [first, last] = [strip[0], strip.at(-1)];
    const low = floorOf(runtime, "low"), high = floorOf(runtime, "high");
    assert.equal(faces(runtime, "platform").length, 2);
    for (const node of [first.l, first.r]) assert.ok(low.nodes.some((n) => n.id === node.id), `low floor lacks ${node.id}`);
    for (const node of [last.l, last.r]) assert.ok(high.nodes.some((n) => n.id === node.id), `high floor lacks ${node.id}`);
    assert.ok(strip.every((row) => Math.abs(row.l.position.y - row.r.position.y) < 1e-9), "every station stays level across");
    assert.ok(low.nodes.every((n) => n.position.y === 0) && high.nodes.every((n) => n.position.y === 3));
    const edgeIds = new Set(runtime.getGraphSnapshot().edges.map((e) => e.edgeId));
    assert.ok(!edgeIds.has("low:edge:1") && !edgeIds.has("high:edge:3"), "the split floor edges must not linger");
  } finally { session.free(); }
});

test("lifting the upper floor carries the ramp end and spreads the climb along the ramp", () => {
  const { runtime, session } = twoFloorsAndRamp();
  try {
    const before = onlyStrip(runtime);
    const high = floorOf(runtime, "high");
    const plan = planEdit(resolveCloudTopology(runtime, high.surfaceKey), { surfaceKey: high.surfaceKey, target: { kind: "region" }, delta: { x: 0, y: 1, z: 0 } }, runtime.getGraphSnapshot(), runtime);
    assert.equal(plan.kind, "apply", plan.reason);
    runtime.applyRegionEdit(plan.ops);
    const after = onlyStrip(runtime);
    assert.ok(floorOf(runtime, "high").nodes.every((n) => n.position.y === 4));
    assert.ok(floorOf(runtime, "low").nodes.every((n) => n.position.y === 0), "the lower floor must not follow");
    assert.equal(after[0].l.position.y, 0);
    assert.equal(after.at(-1).l.position.y, 4);
    for (let i = 1; i < after.length - 1; i += 1) {
      const lift = after[i].l.position.y - before[i].l.position.y;
      assert.ok(lift > 0 && lift < 1, `station ${i} lifted by ${lift}`);
      assert.ok(after[i].l.position.y > after[i - 1].l.position.y, "the ramp keeps climbing");
      assert.ok(Math.abs(after[i].l.position.y - after[i].r.position.y) < 1e-6);
    }
  } finally { session.free(); }
});

test("a ramp and the floors it joins stay separate clouds", () => {
  const { runtime, session } = twoFloorsAndRamp();
  try {
    const low = floorOf(runtime, "low");
    assert.equal(resolveCloudTopology(runtime, low.surfaceKey).members.length, 1);
    const ramp = faces(runtime, "platform-slope")[0];
    assert.equal(resolveCloudTopology(runtime, ramp.surfaceKey).members.length, faces(runtime, "platform-slope").length);
  } finally { session.free(); }
});

test("a spiral climbs its rise around the clicked center, level across every station", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    platformContourTool.onClick(ctx, { point: { x: 20, y: 1, z: 0 } }, { ...params, shape: "spiral", radius: 3, turns: 1.5, rise: 4 });
    const strip = onlyStrip(runtime);
    assert.ok(strip && strip.length > 8, JSON.stringify(calls.feedback));
    const heights = strip.map((row) => row.l.position.y);
    assert.ok(Math.abs(heights[0] - 1) < 1e-6 && Math.abs(heights.at(-1) - 5) < 1e-6);
    assert.ok(strip.every((row) => Math.abs(row.l.position.y - row.r.position.y) < 1e-9));
    for (const row of strip) {
      const radius = Math.hypot((row.l.position.x + row.r.position.x) / 2 - 20, (row.l.position.z + row.r.position.z) / 2);
      assert.ok(Math.abs(radius - 3) < 0.35, `station radius ${radius}`);
    }
  } finally { session.free(); }
});

test("slope clicks commit on a repeated last point and take each height from the pick", () => {
  const { ctx, runtime, session, calls } = sessionFixture();
  try {
    for (const point of [{ x: 0, y: 0, z: 0 }, { x: 6, y: 2, z: 0 }, { x: 6, y: 2, z: 0 }]) platformContourTool.onClick(ctx, { point }, params);
    const strip = onlyStrip(runtime);
    assert.ok(strip, JSON.stringify(calls.feedback));
    assert.equal(strip[0].l.position.y, 0);
    assert.equal(strip.at(-1).l.position.y, 2);
  } finally { session.free(); }
});
