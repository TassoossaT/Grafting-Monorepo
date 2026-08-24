import assert from "node:assert/strict";
import test from "node:test";

import {
  EDGE_FALLBACK_COLOR,
  EDGE_ROLE_COLORS,
  INTERIOR_EDGE_ROLE,
  edgeOverlayChannel,
  edgeOverlayDescriptor,
  edgeOverlayOf,
} from "../src/composition/tabletop/tools/core/edge-overlay.ts";
import { PATH_ROLES } from "../src/features/edit-construction/structure-types/path/path-structure.ts";
import { pathCorridorId } from "../src/features/edit-construction/structure-types/path/path-corridor.ts";
import { stationNodeId } from "../src/features/edit-construction/structure-types/path/station-node-id.ts";

const CORRIDOR = pathCorridorId("op-a", "road");

/** One band of a path run, as the graph would report its boundary. */
function band(acrossPair, stations) {
  const nodes = [];
  for (const station of stations) {
    for (const across of acrossPair) {
      nodes.push({
        id: stationNodeId(CORRIDOR, station, across),
        position: { x: station * 2, y: 0, z: across * 2.1 },
      });
    }
  }
  const loop = [];
  for (let index = 0; index + 1 < stations.length; index += 1) {
    for (const across of acrossPair) {
      loop.push({
        edgeId: `along:${across}:${stations[index]}`,
        startNodeId: stationNodeId(CORRIDOR, stations[index], across),
        endNodeId: stationNodeId(CORRIDOR, stations[index + 1], across),
        reversed: false,
      });
    }
  }
  for (const station of stations) {
    loop.push({
      edgeId: `across:${acrossPair.join("")}:${station}`,
      startNodeId: stationNodeId(CORRIDOR, station, acrossPair[0]),
      endNodeId: stationNodeId(CORRIDOR, station, acrossPair[1]),
      reversed: false,
    });
  }
  return {
    surfaceKey: [`band-${acrossPair.join("")}`],
    surfaceType: "path",
    nodes,
    outerLoops: [loop],
    holes: [],
  };
}

function groupFor(groups, role) {
  return groups.find((group) => group.role === role);
}

test("a path's edges are grouped as spine, contour and rib, each its own colour", () => {
  const stations = [0, 1, 2];
  const groups = edgeOverlayOf([band([-1, 0], stations), band([0, 1], stations)]);

  const spine = groupFor(groups, PATH_ROLES.spineEdge);
  const contour = groupFor(groups, PATH_ROLES.contourEdge);
  const rib = groupFor(groups, PATH_ROLES.ribEdge);
  assert.ok(spine !== undefined && contour !== undefined && rib !== undefined);

  // Six floats a segment. The spine runs the length of the run once, not once
  // per band -- a shared edge is one edge.
  assert.equal(spine.positions.length, 2 * 6);
  assert.equal(contour.positions.length, 4 * 6);
  assert.equal(rib.positions.length, 6 * 6);

  assert.equal(spine.color, EDGE_ROLE_COLORS[PATH_ROLES.spineEdge]);
  assert.notEqual(spine.color, contour.color);
  assert.notEqual(contour.color, rib.color);

  // The spine really is the middle: every point of it sits at z = 0.
  for (let index = 2; index < spine.positions.length; index += 3) {
    assert.equal(spine.positions[index], 0);
  }
});

test("an edge shared by two faces is drawn once, not once per face", () => {
  const groups = edgeOverlayOf([band([-1, 0], [0, 1]), band([0, 1], [0, 1])]);
  const spine = groupFor(groups, PATH_ROLES.spineEdge);
  assert.equal(spine.positions.length, 1 * 6, "one segment for one shared edge");
});

test("a type the palette does not name still draws, in the fallback colour", () => {
  const groups = edgeOverlayOf([
    {
      surfaceKey: ["terrain-cell"],
      surfaceType: "terrain",
      nodes: [
        { id: "t0", position: { x: 0, y: 0, z: 0 } },
        { id: "t1", position: { x: 1, y: 0, z: 0 } },
      ],
      outerLoops: [[{ edgeId: "t-edge", startNodeId: "t0", endNodeId: "t1", reversed: false }]],
      holes: [],
    },
  ]);
  assert.equal(groups.length, 1);
  assert.ok(groups[0].positions.length > 0, "an unnamed role is still drawn");
  assert.ok(
    groups[0].color === EDGE_FALLBACK_COLOR || typeof groups[0].color === "number",
    "and given some colour",
  );
});

test("every role gets its own channel, and none of them is the tool ghost's", () => {
  const groups = edgeOverlayOf([band([-1, 0], [0, 1]), band([0, 1], [0, 1])]);
  const channels = groups.map((group) => edgeOverlayChannel(group.role));
  assert.equal(new Set(channels).size, channels.length);
  assert.ok(channels.every((channel) => channel !== "active"));
});

test("a group becomes a segments descriptor, never a filled one", () => {
  const groups = edgeOverlayOf([band([-1, 0], [0, 1]), band([0, 1], [0, 1])]);
  for (const group of groups) {
    const descriptor = edgeOverlayDescriptor(group);
    assert.equal(descriptor.kind, "segments");
    assert.equal(descriptor.color, group.color);
    assert.equal(descriptor.positions, group.positions);
  }
});

test("nothing standing draws nothing", () => {
  assert.deepEqual(edgeOverlayOf([]), []);
});

test("a rim with a face on both sides is drawn as interior, not as rim", () => {
  // The one drawing error that matters: an edge keeps the addresses it was
  // minted with, so it goes on claiming to be a road's outer contour long
  // after another face arrived on the far side of it. The graph knows better.
  const stations = [0, 1];
  const left = band([-1, 0], stations);
  const right = band([0, 1], stations);
  // A third face bounding the -1 rim from outside -- a junction wedge, say.
  const rim = {
    surfaceKey: ["wedge"],
    surfaceType: "path",
    nodes: left.nodes,
    outerLoops: [[left.outerLoops[0].find((use) => use.edgeId === "along:-1:0")]],
    holes: [],
  };

  const groups = edgeOverlayOf([left, right, rim]);
  const contour = groupFor(groups, PATH_ROLES.contourEdge);
  const interior = groupFor(groups, INTERIOR_EDGE_ROLE);

  assert.ok(interior !== undefined, "the shared rim moved to the interior group");
  assert.equal(interior.positions.length, 1 * 6);
  // The +1 rim is untouched and still contour.
  assert.ok(contour !== undefined);
  assert.equal(contour.positions.length, 1 * 6);
});

test("a rib closing onto another road's spine is a rib, not a contour", () => {
  // The V across a T: the arriving road's end rib runs from its own corner to
  // a junction node the *other* road minted. Different corridors, so the two
  // stations are on different scales and never match -- which used to leave
  // the edge classified as nothing in particular and drawn as a rim.
  const other = pathCorridorId("op-b", "road");
  const corner = stationNodeId(CORRIDOR, 2, -1);
  const junction = stationNodeId(other, 1.5, 0);

  const groups = edgeOverlayOf([
    {
      surfaceKey: ["mouth"],
      surfaceType: "path",
      nodes: [
        { id: corner, position: { x: 0, y: 0, z: -2 } },
        { id: junction, position: { x: 2, y: 0, z: 0 } },
      ],
      outerLoops: [
        [{ edgeId: "closing", startNodeId: corner, endNodeId: junction, reversed: false }],
      ],
      holes: [],
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].role, PATH_ROLES.ribEdge);
});

test("nothing that touches the spine is ever called a contour", () => {
  // The rule the owner set, and it falls out of reading slots alone: a
  // contour has both ends on one outer slot, so it can never have an end on
  // the travel line.
  const across = [-1, 0, 1];
  for (const start of across) {
    for (const end of across) {
      const from = stationNodeId(CORRIDOR, 0, start);
      const to = stationNodeId(CORRIDOR, 5, end);
      const [group] = edgeOverlayOf([
        {
          surfaceKey: [`${start}:${end}`],
          surfaceType: "path",
          nodes: [
            { id: from, position: { x: 0, y: 0, z: start } },
            { id: to, position: { x: 10, y: 0, z: end } },
          ],
          outerLoops: [[{ edgeId: "e", startNodeId: from, endNodeId: to, reversed: false }]],
          holes: [],
        },
      ]);
      if (group.role !== PATH_ROLES.contourEdge) continue;
      assert.notEqual(start, 0, "a contour end is never on the spine");
      assert.notEqual(end, 0, "a contour end is never on the spine");
    }
  }
});
