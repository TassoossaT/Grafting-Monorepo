import assert from "node:assert/strict";
import test from "node:test";

import {
  commitOpeningGroup,
  groupRunSpan,
  isDoorRect,
  MARGIN,
  overlapsOther,
  primaryHostOf,
  runFrame,
  settleRect,
} from "../src/composition/tabletop/tools/openings/opening-shared.ts";
import { surfaceRefFromNodeSet } from "../src/entities/map/index.ts";
import { addFace, sessionFixture } from "./platform-session-fixture.mjs";

/** A straight 8 x 3 wall along +X. */
function wall(runtime, id = "wall", from = { x: 0, z: 0 }, to = { x: 8, z: 0 }, height = 3) {
  return addFace(runtime, id, "wall-white", [
    { id: `${id}:a-bottom`, position: { x: from.x, y: 0, z: from.z } },
    { id: `${id}:b-bottom`, position: { x: to.x, y: 0, z: to.z } },
    { id: `${id}:b-top`, position: { x: to.x, y: height, z: to.z } },
    { id: `${id}:a-top`, position: { x: from.x, y: height, z: from.z } },
  ]);
}

const openingsOf = (runtime) => runtime.getAllRegionTopologies().filter((t) => t.surfaceType === "opening");
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("runFrame measures a lone face as a run of one: length along the base, local height, projection to (s, v)", () => {
  const { runtime, session } = sessionFixture();
  try {
    const run = runFrame(runtime, wall(runtime).surfaceKey);
    assert.equal(run.panels.length, 1);
    assert.ok(near(run.start, 0) && near(run.end, 8, 1e-5));
    assert.ok(near(run.heightAt(4), 3, 1e-9));
    const at = run.project({ x: 2, y: 1.5, z: 0 });
    assert.ok(near(at.s, 2, 1e-5) && near(at.v, 0.5));
  } finally { session.free(); }
});

test("runFrame is undefined for a face that is not an upright panel", () => {
  const { runtime, session } = sessionFixture();
  try {
    const floor = addFace(runtime, "floor", "platform", [[0, 0], [4, 0], [4, 4], [0, 4]].map(([x, z], i) => ({ id: `f:${i}`, position: { x, y: 0, z } })));
    assert.equal(runFrame(runtime, floor.surfaceKey), undefined);
  } finally { session.free(); }
});

test("settleRect keeps MARGIN of wall at the run's ends and above and below, repositioning without resizing", () => {
  const { runtime, session } = sessionFixture();
  try {
    const run = runFrame(runtime, wall(runtime).surfaceKey);
    const pushed = settleRect(run, { s0: -0.8, s1: 0.8, v0: 0.9, v1: 1.2 }, false);
    assert.ok(near(pushed.s0, MARGIN, 1e-6), "left margin is MARGIN in world units");
    assert.ok(near(pushed.v1, 1 - MARGIN / 3, 1e-12), "top margin is MARGIN over the local height");
    assert.ok(near(pushed.s1 - pushed.s0, 1.6, 1e-9) && near(pushed.v1 - pushed.v0, 0.3, 1e-12), "repositioned, never resized");
    assert.equal(settleRect(run, { s0: 0, s1: 7.9, v0: 0.2, v1: 0.4 }, false), undefined, "too wide to keep both margins");
  } finally { session.free(); }
});

test("settleRect stands a door on the floor and reads it back as one", () => {
  const { runtime, session } = sessionFixture();
  try {
    const run = runFrame(runtime, wall(runtime).surfaceKey);
    const door = settleRect(run, { s0: 3, s1: 4, v0: 0.3, v1: 0.9 }, true);
    assert.equal(door.v0, 0);
    assert.ok(near(door.v1, 0.6, 1e-12), "keeps its height");
    assert.ok(isDoorRect(door));
    assert.ok(!isDoorRect(settleRect(run, { s0: 3, s1: 4, v0: 0.3, v1: 0.9 }, false)));
  } finally { session.free(); }
});

test("commitOpeningGroup places one piece per face with its own nodes, every one pinned, one group, one transaction", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const host = wall(runtime);
    const run = runFrame(runtime, host.surfaceKey);
    const result = commitOpeningGroup(ctx, "cause-place", [], run.pieces({ s0: 2, s1: 4, v0: 0.2, v1: 0.6 }));
    assert.equal(result.error, undefined);
    assert.equal(result.recorded, true);

    const [opening] = openingsOf(runtime);
    const hostNodes = new Set(host.nodes.map((node) => node.id));
    assert.ok(opening.nodes.every((node) => !hostNodes.has(node.id) && node.pin !== undefined));
    assert.ok(typeof opening.group === "string" && opening.group.length > 0, "labelled as a group");
    assert.deepEqual(primaryHostOf(opening), host.surfaceKey);
    const span = groupRunSpan(run, [opening]);
    assert.ok(near(span.s0, 2, 1e-5) && near(span.s1, 4, 1e-5) && near(span.v0, 0.2) && near(span.v1, 0.6));
    assert.equal(runtime.getRegionTopology(host.surfaceKey).holes.length, 0);
  } finally { session.free(); }
});

test("commitOpeningGroup replacing: the old pieces go, the new ones stand, nothing else changes", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const run = runFrame(runtime, wall(runtime).surfaceKey);
    commitOpeningGroup(ctx, "cause-a", [], run.pieces({ s0: 1, s1: 2, v0: 0.2, v1: 0.6 }));
    const before = openingsOf(runtime);
    const result = commitOpeningGroup(ctx, "cause-b", before.map((o) => o.surfaceKey), run.pieces({ s0: 5, s1: 6, v0: 0.2, v1: 0.6 }));
    assert.equal(result.error, undefined);
    const after = openingsOf(runtime);
    assert.equal(after.length, 1);
    const span = groupRunSpan(run, after);
    assert.ok(near(span.s0, 5, 1e-5) && near(span.s1, 6, 1e-5));
    const live = new Set(runtime.getGraphSnapshot().nodes.map((node) => node.id));
    assert.ok(before[0].nodes.every((node) => !live.has(node.id)), "the old opening's nodes are gone with it");
  } finally { session.free(); }
});

test("commitOpeningGroup deleting only removes the pieces and nothing on the wall", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const host = wall(runtime);
    const run = runFrame(runtime, host.surfaceKey);
    commitOpeningGroup(ctx, "cause-a", [], run.pieces({ s0: 1, s1: 2, v0: 0.2, v1: 0.6 }));
    const result = commitOpeningGroup(ctx, "cause-delete", openingsOf(runtime).map((o) => o.surfaceKey), []);
    assert.equal(result.error, undefined);
    assert.equal(openingsOf(runtime).length, 0);
    assert.deepEqual(runtime.getRegionTopology(host.surfaceKey).nodes, host.nodes);
  } finally { session.free(); }
});

test("overlapsOther refuses sharing area on the run, allows touching, and never counts the excluded group", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const run = runFrame(runtime, wall(runtime).surfaceKey);
    commitOpeningGroup(ctx, "cause-a", [], run.pieces({ s0: 2, s1: 3, v0: 0.2, v1: 0.6 }));
    const [standing] = openingsOf(runtime);
    const standingRef = surfaceRefFromNodeSet(standing.surfaceKey);
    assert.equal(overlapsOther(ctx, run, { s0: 2.5, s1: 3.5, v0: 0.3, v1: 0.7 }), true);
    assert.equal(overlapsOther(ctx, run, { s0: 3, s1: 4, v0: 0.2, v1: 0.6 }), false, "touching is not overlapping");
    assert.equal(overlapsOther(ctx, run, { s0: 2.5, s1: 3.5, v0: 0.3, v1: 0.7 }, new Set([standingRef])), false);
  } finally { session.free(); }
});
