import assert from "node:assert/strict";
import test from "node:test";

import { pathCorridorId, pathSubtypeOf } from "../src/features/edit-construction/structure-types/path/path-corridor.ts";
import { pathCarvesGround, pathRidesTerrain } from "../src/features/edit-construction/structure-types/path/path-recipe.ts";
import { parseStationNodeId, stationNodeId } from "../src/features/edit-construction/structure-types/path/station-node-id.ts";
import { resolveCreationInteraction } from "../src/features/edit-construction/structure-types/index.ts";

// The station-welding tests that used to live here (`pathPatch`'s
// weld-by-address behaviour) were retired with the station-sweep commit
// path -- see `path-shared.ts`'s `commitPathContour` doc. The spine-contour
// engine that replaces it welds by *position* instead; that behaviour is
// covered in `spine-contour.test.mjs` ("re-consuming a standing band...
// welds every vertex back onto its own former id"), not here.
//
// `station-node-id.ts` itself is still real code -- `path-structure.ts`'s
// edit-role model still reads it for interactive dragging of an
// already-committed road (a still-open gap the new engine's own commits
// don't yet address; see `commitPathContour`'s doc) -- so these three tests
// of subtype/interaction declarations stay exactly as they were.

test("a corridor id carries its subtype without disturbing station addressing", () => {
  const corridor = pathCorridorId("table-1:path-brush:3", "road");
  assert.equal(corridor, "table-1:path-brush:3#road");
  assert.equal(pathSubtypeOf(corridor), "road");

  // The marker is appended, so a node id built on it still parses whole.
  const node = stationNodeId(corridor, 4, -2);
  assert.deepEqual(parseStationNodeId(node), {
    operationId: corridor,
    station: 4,
    across: -2,
  });
  assert.equal(pathSubtypeOf(parseStationNodeId(node).operationId), "road");
  assert.equal(pathSubtypeOf("some-wall-node"), undefined);
});

test("a deck spans and consumes nothing; every other subtype rides and carves", () => {
  assert.equal(pathRidesTerrain("bridge"), false);
  assert.equal(pathCarvesGround("bridge"), false);
  for (const kind of ["road", "street", "trail"]) {
    assert.equal(pathRidesTerrain(kind), true, kind);
    assert.equal(pathCarvesGround(kind), true, kind);
  }
});

test("the interaction table reads the painted subtype, so an overpass declares itself", () => {
  // Same pair of types, opposite outcomes -- decided by the run that spans,
  // never inferred from a flat footprint that cannot see height at all.
  assert.equal(resolveCreationInteraction("path", "terrain", "road").kind, "cut");
  assert.equal(resolveCreationInteraction("path", "terrain", "bridge").kind, "ignore");
  assert.equal(resolveCreationInteraction("path", "path", "bridge").kind, "ignore");
  assert.equal(resolveCreationInteraction("path", "terrain").kind, "cut");
});
