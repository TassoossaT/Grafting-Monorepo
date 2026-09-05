import assert from "node:assert/strict";
import test from "node:test";

import {
  houseRoomDeleteTool,
  roomSurfaceKeys,
} from "../src/composition/tabletop/tools/house/house-room-delete-tool.ts";
import { findEnclosingRoom } from "../src/composition/tabletop/tools/house/room-lookup.ts";
import { panelTopology, WALL_HEIGHT } from "./wall-spans-fixture.mjs";

const CORNERS = {
  sw: { x: 0, z: 0 },
  ms: { x: 2, z: 0 },
  se: { x: 4, z: 0 },
  ne: { x: 4, z: 4 },
  mn: { x: 2, z: 4 },
  nw: { x: 0, z: 4 },
};

function wallTopology(id, fromName, toName) {
  return panelTopology(
    id,
    { from: CORNERS[fromName], to: CORNERS[toName] },
    {
      bottomFrom: `${fromName}:bottom`,
      bottomTo: `${toName}:bottom`,
      topTo: `${toName}:top`,
      topFrom: `${fromName}:top`,
    },
  );
}

function openingTopology(id, from, to, type = "door") {
  const nodes = [
    { id: `${id}:0`, position: { x: from.x, y: 0, z: from.z } },
    { id: `${id}:1`, position: { x: to.x, y: 0, z: to.z } },
    { id: `${id}:2`, position: { x: to.x, y: 2, z: to.z } },
    { id: `${id}:3`, position: { x: from.x, y: 2, z: from.z } },
  ];
  return {
    surfaceKey: ["@region", id],
    surfaceType: type,
    physical: false,
    outerLoops: [],
    holes: [],
    nodes,
  };
}

function mockRuntime(topologies) {
  const removedSurfaces = [];
  return {
    removedSurfaces,
    getAllRegionTopologies: () => topologies,
    removeSurface: (req, origin, causeId) => {
      removedSurfaces.push({ surfaceKey: req.surfaceKey, origin, causeId });
      return {
        affectedSurfaceKeys: [],
        createdSurfaceKeys: [],
        removedSurfaceKeys: [req.surfaceKey],
        createdNodeIds: [],
        removedNodeIds: [],
      };
    },
  };
}

function mockContext(topologies) {
  let seq = 0;
  const runtime = mockRuntime(topologies);
  return {
    runtime,
    nextSequence: () => ++seq,
    tableId: "table-1",
    history: {},
    snapToGrid: false,
  };
}

test("roomSurfaceKeys returns the real surface keys of the perimeter walls of a subdivided room", () => {
  const topologies = [
    wallTopology("south-west", "sw", "ms"),
    wallTopology("south-east", "ms", "se"),
    wallTopology("east", "se", "ne"),
    wallTopology("north-east", "ne", "mn"),
    wallTopology("north-west", "mn", "nw"),
    wallTopology("west", "nw", "sw"),
    wallTopology("mid", "ms", "mn"),
  ];
  const ctx = mockContext(topologies);
  const westRoom = findEnclosingRoom(ctx, { x: 1, y: 0, z: 2 });
  assert.ok(westRoom !== undefined);

  const keys = roomSurfaceKeys(ctx, westRoom);
  const keyStrings = keys.map((k) => k.join(":"));
  assert.equal(keys.length, 4);
  assert.ok(keyStrings.includes("@region:south-west"));
  assert.ok(keyStrings.includes("@region:mid"));
  assert.ok(keyStrings.includes("@region:north-west"));
  assert.ok(keyStrings.includes("@region:west"));

  // Must not include walls from the adjacent east room
  assert.ok(!keyStrings.includes("@region:south-east"));
  assert.ok(!keyStrings.includes("@region:east"));
  assert.ok(!keyStrings.includes("@region:north-east"));
});

test("roomSurfaceKeys recovers notched wall panels and embedded openings along the room perimeter", () => {
  // Replace the single north-west wall (0,4 to 2,4) with two panels and a door in between
  const topologies = [
    wallTopology("south-west", "sw", "ms"),
    panelTopology("nw-part1", { from: { x: 0, z: 4 }, to: { x: 0.8, z: 4 } }),
    openingTopology("nw-door", { x: 0.8, z: 4 }, { x: 1.2, z: 4 }, "door"),
    panelTopology("nw-part2", { from: { x: 1.2, z: 4 }, to: { x: 2, z: 4 } }),
    wallTopology("west", "nw", "sw"),
    wallTopology("mid", "ms", "mn"),
  ];
  const ctx = mockContext(topologies);
  const room = {
    bottomCycle: ["sw:bottom", "ms:bottom", "mn:bottom", "nw:bottom"],
    topCycle: ["sw:top", "ms:top", "mn:top", "nw:top"],
    polygon: [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 4 },
      { x: 0, z: 4 },
    ],
  };

  const keys = roomSurfaceKeys(ctx, room);
  const keyStrings = keys.map((k) => k.join(":"));
  assert.ok(keyStrings.includes("@region:south-west"));
  assert.ok(keyStrings.includes("@region:nw-part1"));
  assert.ok(keyStrings.includes("@region:nw-door"));
  assert.ok(keyStrings.includes("@region:nw-part2"));
  assert.ok(keyStrings.includes("@region:west"));
  assert.ok(keyStrings.includes("@region:mid"));
});

test("houseRoomDeleteTool.onClick removes all bounding walls when clicking inside an enclosed room", () => {
  const topologies = [
    wallTopology("south-west", "sw", "ms"),
    wallTopology("south-east", "ms", "se"),
    wallTopology("east", "se", "ne"),
    wallTopology("north-east", "ne", "mn"),
    wallTopology("north-west", "mn", "nw"),
    wallTopology("west", "nw", "sw"),
    wallTopology("mid", "ms", "mn"),
  ];
  const ctx = mockContext(topologies);

  houseRoomDeleteTool.onClick(ctx, { point: { x: 1, y: 0, z: 2 } });
  const removedKeys = ctx.runtime.removedSurfaces.map((r) => r.surfaceKey.join(":"));
  assert.equal(removedKeys.length, 4);
  assert.ok(removedKeys.includes("@region:south-west"));
  assert.ok(removedKeys.includes("@region:mid"));
  assert.ok(removedKeys.includes("@region:north-west"));
  assert.ok(removedKeys.includes("@region:west"));
});

test("houseRoomDeleteTool.onClick removes single wall and its embedded opening on direct wall hit", () => {
  const topologies = [
    panelTopology("wall-test", { from: { x: 0, z: 0 }, to: { x: 4, z: 0 } }),
    openingTopology("window-1", { x: 1.5, z: 0 }, { x: 2.5, z: 0 }, "window"),
  ];
  const ctx = mockContext(topologies);

  // Click directly on wall-test at (1, 0, 0.05)
  houseRoomDeleteTool.onClick(ctx, { point: { x: 1, y: 0, z: 0.05 } });
  const removedKeys = ctx.runtime.removedSurfaces.map((r) => r.surfaceKey.join(":"));
  assert.ok(removedKeys.includes("@region:wall-test"));
  assert.ok(removedKeys.includes("@region:window-1"));
});
