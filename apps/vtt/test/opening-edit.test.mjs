import assert from "node:assert/strict";
import test from "node:test";

import {
  clampRect,
  commitOpeningReplacement,
  hostFrame,
  hostsOf,
  isDoorRect,
  MARGIN,
  overlapsSibling,
  primaryHostOf,
  spanOn,
} from "../src/composition/tabletop/tools/openings/opening-shared.ts";
import { openingTool } from "../src/composition/tabletop/tools/openings/opening-tool.ts";
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

test("hostFrame measures the face through the engine: length along the base, local height at u", () => {
  const { runtime, session } = sessionFixture();
  try {
    const host = wall(runtime);
    const frame = hostFrame(runtime, host.surfaceKey);
    assert.ok(Math.abs(frame.length - 8) < 1e-9);
    assert.ok(Math.abs(frame.heightAt(0.5) - 3) < 1e-9);
    const [point] = frame.project([{ x: 2, y: 1.5, z: 0 }]);
    assert.ok(Math.abs(point.u - 0.25) < 1e-9 && Math.abs(point.v - 0.5) < 1e-9 && point.inside);
  } finally { session.free(); }
});

test("clampRect keeps MARGIN of face on every side, converted into u and v by the face's own size", () => {
  const { runtime, session } = sessionFixture();
  try {
    const frame = hostFrame(runtime, wall(runtime).surfaceKey);
    const pushed = clampRect(frame, { u0: -0.1, u1: 0.1, v0: 0.9, v1: 1.2 }, false);
    assert.ok(Math.abs(pushed.u0 - MARGIN / 8) < 1e-12, "left margin is MARGIN over the face length");
    assert.ok(Math.abs(pushed.v1 - (1 - MARGIN / 3)) < 1e-12, "top margin is MARGIN over the local height");
    assert.ok(Math.abs(pushed.u1 - pushed.u0 - 0.2) < 1e-12 && Math.abs(pushed.v1 - pushed.v0 - 0.3) < 1e-12, "repositioned, never resized");
    assert.equal(clampRect(frame, { u0: 0, u1: 0.99, v0: 0.2, v1: 0.4 }, false), undefined, "too wide to keep both margins");
  } finally { session.free(); }
});

test("clampRect stands a door on the floor and reads it back as one", () => {
  const { runtime, session } = sessionFixture();
  try {
    const frame = hostFrame(runtime, wall(runtime).surfaceKey);
    const door = clampRect(frame, { u0: 0.4, u1: 0.5, v0: 0.3, v1: 0.9 }, true);
    assert.equal(door.v0, 0);
    assert.ok(Math.abs(door.v1 - 0.6) < 1e-12, "keeps its height");
    assert.ok(isDoorRect(door));
    assert.ok(!isDoorRect(clampRect(frame, { u0: 0.4, u1: 0.5, v0: 0.3, v1: 0.9 }, false)));
  } finally { session.free(); }
});

test("commitOpeningReplacement places an opening with its own nodes, every one pinned, in one transaction", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const host = wall(runtime);
    const frame = hostFrame(runtime, host.surfaceKey);
    const result = commitOpeningReplacement(ctx, "cause-place", undefined, { frame, rect: { u0: 0.25, u1: 0.5, v0: 0.2, v1: 0.6 } });
    assert.equal(result.error, undefined);
    assert.equal(result.recorded, true);

    const [opening] = openingsOf(runtime);
    const hostNodes = new Set(host.nodes.map((node) => node.id));
    assert.ok(opening.nodes.every((node) => !hostNodes.has(node.id) && node.pin !== undefined));
    assert.deepEqual(primaryHostOf(opening), host.surfaceKey);
    const span = spanOn(frame, opening);
    assert.deepEqual(span, { u0: 0.25, u1: 0.5, v0: 0.2, v1: 0.6 });
    assert.equal(runtime.getRegionTopology(host.surfaceKey).holes.length, 0);
  } finally { session.free(); }
});

test("commitOpeningReplacement replacing: the old region goes, the new one stands, nothing else changes", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const host = wall(runtime);
    const frame = hostFrame(runtime, host.surfaceKey);
    commitOpeningReplacement(ctx, "cause-a", undefined, { frame, rect: { u0: 0.1, u1: 0.3, v0: 0.2, v1: 0.6 } });
    const [before] = openingsOf(runtime);
    const result = commitOpeningReplacement(ctx, "cause-b", before.surfaceKey, { frame, rect: { u0: 0.6, u1: 0.8, v0: 0.2, v1: 0.6 } });
    assert.equal(result.error, undefined);
    const after = openingsOf(runtime);
    assert.equal(after.length, 1);
    assert.deepEqual(spanOn(frame, after[0]), { u0: 0.6, u1: 0.8, v0: 0.2, v1: 0.6 });
    const live = new Set(runtime.getGraphSnapshot().nodes.map((node) => node.id));
    assert.ok(before.nodes.every((node) => !live.has(node.id)), "the old opening's nodes are gone with it");
  } finally { session.free(); }
});

test("commitOpeningReplacement deleting only removes the region and nothing on the wall", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const host = wall(runtime);
    const frame = hostFrame(runtime, host.surfaceKey);
    commitOpeningReplacement(ctx, "cause-a", undefined, { frame, rect: { u0: 0.1, u1: 0.3, v0: 0.2, v1: 0.6 } });
    const result = commitOpeningReplacement(ctx, "cause-delete", openingsOf(runtime)[0].surfaceKey, undefined);
    assert.equal(result.error, undefined);
    assert.equal(openingsOf(runtime).length, 0);
    assert.deepEqual(runtime.getRegionTopology(host.surfaceKey).nodes, host.nodes);
  } finally { session.free(); }
});

test("overlapsSibling refuses sharing area on the same host, allows touching, and never counts the opening itself", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const host = wall(runtime);
    const frame = hostFrame(runtime, host.surfaceKey);
    commitOpeningReplacement(ctx, "cause-a", undefined, { frame, rect: { u0: 0.2, u1: 0.4, v0: 0.2, v1: 0.6 } });
    const [standing] = openingsOf(runtime);
    assert.equal(overlapsSibling(ctx, frame, { u0: 0.3, u1: 0.5, v0: 0.3, v1: 0.7 }), true);
    assert.equal(overlapsSibling(ctx, frame, { u0: 0.4, u1: 0.6, v0: 0.2, v1: 0.6 }), false, "touching is not overlapping");
    assert.equal(overlapsSibling(ctx, frame, { u0: 0.3, u1: 0.5, v0: 0.3, v1: 0.7 }, standing.surfaceKey), false);
  } finally { session.free(); }
});

test("an opening pinned to two hosts at a corner reads both hosts, selects, and deletes without breaking", () => {
  const { runtime, session, ctx } = sessionFixture();
  try {
    const a = wall(runtime, "a", { x: 0, z: 0 }, { x: 4, z: 0 });
    const b = wall(runtime, "b", { x: 4, z: 0 }, { x: 4, z: 4 });
    const corners = [
      { id: "o:0", position: { x: 3, y: 1, z: 0 }, host: a, u: 0.75 },
      { id: "o:1", position: { x: 4, y: 1, z: 1 }, host: b, u: 0.25 },
      { id: "o:2", position: { x: 4, y: 2, z: 1 }, host: b, u: 0.25 },
      { id: "o:3", position: { x: 3, y: 2, z: 0 }, host: a, u: 0.75 },
    ];
    const edges = corners.map((corner, index) => ({ edgeId: `o:e${index}`, startNodeId: corner.id, endNodeId: corners[(index + 1) % 4].id }));
    runtime.addPatch({
      nodes: corners.map(({ id, position }) => ({ id, position })),
      edges,
      regions: [{ regionId: "corner-window", boundary: edges.map((edge) => ({ edgeId: edge.edgeId, reversed: false })), surfaceType: "opening", physical: false }],
    });
    runtime.pinNodes(corners.map((corner) => ({ nodeId: corner.id, hostSurfaceKey: corner.host.surfaceKey, u: corner.u, v: corner.position.y / 3 })));

    const [opening] = openingsOf(runtime);
    assert.equal(hostsOf(opening).size, 2);
    const span = spanOn(hostFrame(runtime, primaryHostOf(opening)), opening);
    assert.ok(span !== undefined && span.u1 > span.u0);

    const down = { x: 3, y: 1, z: 0 };
    openingTool.onPointerDown(ctx, { point: down, nodeId: "o:0" }, { openingKind: "window", width: 1, height: 1, sill: 1 });
    openingTool.onPointerUp(ctx, { start: { point: down }, current: { point: { x: 1, y: 1, z: 0 } } }, { openingKind: "window", width: 1, height: 1, sill: 1 });
    openingTool.onClick(ctx, { point: { x: 1, y: 1, z: 0 } }, { openingKind: "window", width: 1, height: 1, sill: 1 });
    assert.equal(openingsOf(runtime).length, 1, "selected, not rebuilt on one host");
    assert.deepEqual(openingsOf(runtime)[0].nodes.map((node) => node.position), corners.map((corner) => corner.position));

    openingTool.onDeleteKey(ctx);
    assert.equal(openingsOf(runtime).length, 0);
  } finally { session.free(); }
});
