import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudNodes,
  refreshCloudTopology,
  resolveCloud,
  resolveCloudTopology,
} from "../src/features/edit-construction/index.ts";
import { cloudSourceOver } from "./cloud-fixture.mjs";
import { panelTopology } from "./wall-spans-fixture.mjs";

/** Two panels welded at the corner they share, plus one terrain face touching neither. */
const FIRST = panelTopology("wall-1", { from: { x: 0, z: 0 }, to: { x: 4, z: 0 } });
const SECOND = panelTopology("wall-2", { from: { x: 4, z: 0 }, to: { x: 8, z: 0 } }, {
  bottomFrom: "wall-1:b-bottom",
  bottomTo: "wall-2:b-bottom",
  topTo: "wall-2:b-top",
  topFrom: "wall-1:b-top",
});
const GROUND = { ...panelTopology("terrain-1", { from: { x: 0, z: 9 }, to: { x: 4, z: 9 } }), surfaceType: "terrain" };

const SOURCE = cloudSourceOver([FIRST, SECOND, GROUND]);

test("a cloud takes its type from the surface it was seeded at, and never spans two", () => {
  const cloud = resolveCloud(SOURCE, FIRST.surfaceKey);
  assert.ok(cloud !== undefined);
  assert.equal(cloud.surfaceType, "wall-white");
  assert.deepEqual(cloud.members, [FIRST.surfaceKey, SECOND.surfaceKey]);

  const ground = resolveCloud(SOURCE, GROUND.surfaceKey);
  assert.ok(ground !== undefined);
  assert.equal(ground.surfaceType, "terrain");
  assert.deepEqual(ground.members, [GROUND.surfaceKey]);
});

test("a component of one is not a special case -- it reports itself as its own only member", () => {
  const cloud = resolveCloud(cloudSourceOver([FIRST]), FIRST.surfaceKey);
  assert.ok(cloud !== undefined);
  assert.deepEqual(cloud.members, [FIRST.surfaceKey]);
});

test("the seed is a member even when the engine reports membership without it", () => {
  const forgetful = {
    getRegionTopology: SOURCE.getRegionTopology,
    cloudFor: () => ({ surfaceKeys: [SECOND.surfaceKey] }),
  };
  const cloud = resolveCloud(forgetful, FIRST.surfaceKey);
  assert.ok(cloud !== undefined);
  assert.deepEqual(cloud.members, [FIRST.surfaceKey, SECOND.surfaceKey]);
});

test("a stale key resolves to no cloud rather than to an empty one", () => {
  assert.equal(resolveCloud(SOURCE, ["@region", "never-existed"]), undefined);
  assert.equal(resolveCloudTopology(SOURCE, ["@region", "never-existed"]), undefined);
});

test("a cloud topology carries every member's boundary and names which one was grabbed", () => {
  const topology = resolveCloudTopology(SOURCE, SECOND.surfaceKey);
  assert.ok(topology !== undefined);
  assert.equal(topology.seed.surfaceKey, SECOND.surfaceKey);
  assert.deepEqual(
    topology.members.map((member) => member.surfaceKey),
    [FIRST.surfaceKey, SECOND.surfaceKey],
  );
});

test("welded members share nodes, and the cloud reports each one once", () => {
  const topology = resolveCloudTopology(SOURCE, FIRST.surfaceKey);
  assert.ok(topology !== undefined);
  const ids = cloudNodes(topology).map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length);
  // Four columns' worth of nodes across two panels, not eight: the shared
  // column is one column, which is the whole of what welding means.
  assert.equal(ids.length, 6);
});

test("a refresh re-reads positions but keeps the membership the gesture started with", () => {
  const moved = {
    ...FIRST,
    nodes: FIRST.nodes.map((node) =>
      node.id === "wall-1:a-bottom" ? { ...node, position: { x: 99, y: 0, z: 0 } } : node,
    ),
  };
  const grabbed = resolveCloudTopology(SOURCE, FIRST.surfaceKey);
  assert.ok(grabbed !== undefined);

  // A third panel appears mid-drag; the refresh must not pick it up.
  const third = panelTopology("wall-3", { from: { x: 8, z: 0 }, to: { x: 12, z: 0 } });
  const later = cloudSourceOver([moved, SECOND, GROUND, third]);
  const refreshed = refreshCloudTopology(later, grabbed.cloud);

  assert.ok(refreshed !== undefined);
  assert.deepEqual(
    refreshed.members.map((member) => member.surfaceKey),
    [FIRST.surfaceKey, SECOND.surfaceKey],
  );
  assert.deepEqual(
    cloudNodes(refreshed).find((node) => node.id === "wall-1:a-bottom")?.position,
    { x: 99, y: 0, z: 0 },
  );
});

test("a member that disappeared mid-drag is dropped, not fatal -- the rest of the cloud still moves", () => {
  const grabbed = resolveCloudTopology(SOURCE, FIRST.surfaceKey);
  assert.ok(grabbed !== undefined);
  const refreshed = refreshCloudTopology(cloudSourceOver([FIRST, GROUND]), grabbed.cloud);
  assert.ok(refreshed !== undefined);
  assert.deepEqual(
    refreshed.members.map((member) => member.surfaceKey),
    [FIRST.surfaceKey],
  );
});

test("losing the seed itself ends the resolution -- there is nothing left to have grabbed", () => {
  const grabbed = resolveCloudTopology(SOURCE, FIRST.surfaceKey);
  assert.ok(grabbed !== undefined);
  assert.equal(refreshCloudTopology(cloudSourceOver([SECOND]), grabbed.cloud), undefined);
});
