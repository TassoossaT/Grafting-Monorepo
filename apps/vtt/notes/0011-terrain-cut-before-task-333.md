# Note 0011 — The terrain cut before TASK-333, and how to get it back

- Recorded: 2026-09-28
- Status: reference snapshot; the owner plans to refine the cut at the end of the epic
- Related: PR #334 (TASK-333-PLATFORM-TYPES), #338 (per-type cut calibration), ground contact law

## Why this exists

The terrain cut on master before this branch behaved well. TASK-333 rewrote much of it:
- the ground contact law, which cuts only where a structure rests on the ground, within 1.5 m;
- partial cuts along where the ground rises through a structure;
- sealed ramp outlines;
- move repair, covering dragged faces, vacated ground and suspended portions;
- the executor split into modules.

The result still has known errors, most visibly with a floor half in and half out of a hill. This note keeps the
exact pre-branch state recoverable, file by file, if something has to be brought back.

## Baseline

Pre-branch master: `0e0d6a6a2641274ec7a05183a1b6969c742e5d7e` (`0e0d6a6a`). The branch forked there, so the diffs below are that commit against the
branch head at the time of writing.

## How to recover

- A whole file as it was: `git show 0e0d6a6a:<path>`.
- A whole file restored in a task worktree: `git checkout 0e0d6a6a -- <path>`, then commit through ia-graft.
- One hunk: copy the `-` lines from the diff below.

Files marked *new* did not exist before. Their logic came out of `terrain-cut-executor.ts`, or is new behavior. To go back
fully, restore the old executor and drop them.

## Files of the cut changed by this branch

| File | Lines | What changed |
| --- | --- | --- |
| `composition/tabletop/terrain/terrain-cut-executor.ts` | +61 −580 | executor: split up; stale regions; ground heights read from faces |
| `composition/tabletop/terrain/structure-contact.ts` | +233 −0 | new — extracted from the executor; contact area, rings, underside heights |
| `composition/tabletop/terrain/constraint-rings.ts` | +497 −0 | new — extracted from the executor; buildConstraintRings, anchoredConstraints |
| `composition/tabletop/terrain/terrain-lattice-reaction.ts` | +403 −29 | which ground a change repairs: dragged faces, vacated ground, let-go |
| `composition/tabletop/terrain/terrain-regenerate.ts` | +79 −16 | repair entry: fallout, stale regions, suspended portions |
| `composition/tabletop/terrain/terrain-fill.ts` | +164 −5 | fill: ring corner adoption, alias edge orientation |
| `composition/tabletop/terrain/terrain-diagnostics.ts` | +5 −25 | diagnostics log |
| `features/edit-construction/topology/ground-contact.ts` | +246 −0 | new — ground contact law -- 1.5 m reach, partial cut by marching squares |
| `features/edit-construction/topology/ring-simplify.ts` | +116 −1 | collinear perimeter vertex simplification |
| `features/edit-construction/effects/effect-pipeline.ts` | +4 −1 | cut reaches only ground the structure touches (touchesGround gate) |
| `composition/tabletop/effects/change-area.ts` | +2 −12 | claimed/vacated area of a change |
| `composition/tabletop/effects/effect-commit.ts` | +96 −4 | commit wiring of the cut reaction |
| `features/edit-construction/structure-types/structural-cut.ts` | +2 −0 | StructuralCutRequest.staleRegions |

On master, `effect-pipeline.ts` held a literal NUL byte inside a string, the key separator. It shows as `<NUL>` in its diff, and the branch writes it as `"\u0000"`, the same value. Git counts that file as binary, so view it with `git diff --text`.

Not included, though the cut uses them:
- `topology/plan-geometry.ts`, the shared geometry helpers;
- `structure-types/structure-type.ts`, whose `CutFallout.draggedSurfaceKeys` field is in the same commit as `staleRegions`;
- the new tests `test/ground-contact.test.mjs`, `test/platform-hill-cut.test.mjs` and `test/platform-suspended-cut-move.test.mjs`.

## Diffs (pre-branch master → branch)

### `apps/vtt/src/composition/tabletop/terrain/terrain-cut-executor.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/terrain/terrain-cut-executor.ts b/apps/vtt/src/composition/tabletop/terrain/terrain-cut-executor.ts
index ebb47832..6cdce6e4 100644
--- a/apps/vtt/src/composition/tabletop/terrain/terrain-cut-executor.ts
+++ b/apps/vtt/src/composition/tabletop/terrain/terrain-cut-executor.ts
@@ -1,6 +1,5 @@
 import type {
   ConstructionCoveredRegion,
-  ConstructionGridConstraintPoint,
   ConstructionNodeId,
   ConstructionPosition,
   ConstructionRegionEdge,
@@ -17,14 +16,19 @@ import {
   calculateProfileHeight,
   distanceAndElevationOnPath,
   hasTrait,
+  insideRingXZ,
+  groundSurfaceOf,
 } from "../../../features/edit-construction/index.ts";
 
 import {
-  constraintsFromRings,
   perimeterConstraints,
   type ConstraintRing,
   type ConstraintTable,
 } from "./terrain-constraints.ts";
+import { buildConstraintRings } from "./constraint-rings.ts";
+import { meetStructures, NO_STRUCTURES, type StructureMeeting } from "./structure-contact.ts";
+
+export { buildConstraintRings } from "./constraint-rings.ts";
 import { DEFAULT_FACE_SIDE, fillTerrain } from "./terrain-fill.ts";
 import { timePhase } from "../commit-timing.ts";
 import {
@@ -33,7 +37,6 @@ import {
   type TerrainCutRuntime,
   type TerrainStrokeBounds,
 } from "./terrain-neighborhood.ts";
-import { paintedFalloutOf, paintedTopologiesOf } from "../interference/painted-topologies.ts";
 import { planarUnion, planarDifference } from "../../../features/edit-construction/index.ts";
 import type { PlanarArea, PlanarPolygon } from "@/features/edit-construction";
 
@@ -50,30 +53,9 @@ function centroidOf(nodes: readonly { readonly position: ConstructionPosition }[
   return { x: x / nodes.length, y: y / nodes.length, z: z / nodes.length };
 }
 
-function insidePolygon(point: ConstructionPosition, polygon: readonly (readonly [number, number])[]): boolean {
-  let inside = false;
-  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i++) {
-    const [xi, zi] = polygon[i]!;
-    const [xj, zj] = polygon[j]!;
-    if (zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi) {
-      inside = !inside;
-    }
-  }
-  return inside;
-}
 
 function insideSwept(point: ConstructionPosition, swept: PlanarArea): boolean {
-  const inRing = (ring: readonly (readonly [number, number])[]): boolean => {
-    let inside = false;
-    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
-      const [ax, az] = ring[index]!;
-      const [bx, bz] = ring[previous]!;
-      if (az > point.z !== bz > point.z && point.x < ((bx - ax) * (point.z - az)) / (bz - az) + ax) {
-        inside = !inside;
-      }
-    }
-    return inside;
-  };
+  const inRing = (ring: readonly (readonly [number, number])[]): boolean => insideRingXZ(ring, point);
   for (const polygon of swept) {
     const outer = polygon[0];
     if (outer === undefined || !inRing(outer)) continue;
@@ -96,15 +78,15 @@ function faceIntersectsArea(
   }
   if (outline && outline.length > 0) {
     for (const node of topology.nodes) {
-      if (insidePolygon(node.position, outline)) return true;
+      if (insideRingXZ(outline, node.position)) return true;
     }
-    return insidePolygon(centroidOf(topology.nodes), outline);
+    return insideRingXZ(outline, centroidOf(topology.nodes));
   }
   if (area.outline && area.outline.length > 0) {
     for (const node of topology.nodes) {
-      if (insidePolygon(node.position, area.outline)) return true;
+      if (insideRingXZ(area.outline, node.position)) return true;
     }
-    return insidePolygon(centroidOf(topology.nodes), area.outline);
+    return insideRingXZ(area.outline, centroidOf(topology.nodes));
   }
   return false;
 }
@@ -164,20 +146,6 @@ function loopToPolygon(
   return ring ? [ring] : [];
 }
 
-function topologyToPolygonWithHoles(
-  topology: ConstructionRegionTopology,
-  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
-): PlanarPolygon {
-  if (topology.outerLoops.length === 0) return [];
-  const outer = loopToRing(topology.outerLoops[0]!, positionOf);
-  if (!outer) return [];
-  const rings: [number, number][][] = [outer];
-  for (const holeLoop of topology.holes) {
-    const hole = loopToRing(holeLoop, positionOf);
-    if (hole) rings.push(hole);
-  }
-  return rings;
-}
 
 
 /**
@@ -206,21 +174,6 @@ function widthOf(polygon: PlanarArea): number {
   return (2 * Math.abs(area / 2)) / perimeter;
 }
 
-function pieceMetrics(piece: PlanarArea[number]): { readonly area: number; readonly width: number } {
-  let area = 0;
-  let perimeter = 0;
-  for (const ring of piece) {
-    for (let index = 0; index < ring.length - 1; index += 1) {
-      const [ax, az] = ring[index]!;
-      const [bx, bz] = ring[index + 1]!;
-      area += ax * bz - bx * az;
-      perimeter += Math.hypot(bx - ax, bz - az);
-    }
-  }
-  const absArea = Math.abs(area / 2);
-  const width = perimeter > 1e-9 ? (2 * absArea) / perimeter : 0;
-  return { area: absArea, width };
-}
 
 
 function topologyToPolygon(topology: ConstructionRegionTopology): PlanarPolygon {
@@ -243,435 +196,6 @@ function topologyToPolygon(topology: ConstructionRegionTopology): PlanarPolygon
   return [ring];
 }
 
-/** Two nodes name one edge whichever way round they are given. */
-function pairKey(a: number, b: number): string {
-  return a < b ? `${a}:${b}` : `${b}:${a}`;
-}
-
-/**
- * Dropping corners the boolean invented in the middle of an edge that already
- * existed.
- *
- * Where the ground's own rim crosses the painter's contour, the boolean
- * splits both and hands back a vertex at the crossing. That vertex names no
- * node -- it never was one -- and its presence breaks one segment into two,
- * *neither* of which runs between a pair of adjacent nodes any more. So neither
- * knows which edge it lies on, and every corner the generator later lands there
- * is discarded with nothing split: the ground meets the painter at a coincident
- * position instead of at a node, once per crossing. That is the tooth.
- *
- * A corner sitting on the straight line between two nodes that really are
- * joined by an edge adds nothing the ring did not already say. Removing it
- * restores the segment to the pair it belongs to, and the split lands where it
- * should. Only a corner that is genuinely *on* that line goes -- one where the
- * rim leaves the contour is a real corner and stays.
- */
-/** Whether `point` sits on the span `from`-`to`, ends included, within `tolerance`. */
-function onSpan(
-  point: { readonly x: number; readonly z: number },
-  from: { readonly x: number; readonly z: number },
-  to: { readonly x: number; readonly z: number },
-  tolerance: number,
-): boolean {
-  const dx = to.x - from.x;
-  const dz = to.z - from.z;
-  const lengthSq = dx * dx + dz * dz;
-  if (lengthSq <= 1e-12) return false;
-  const along = ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSq;
-  if (along < -1e-9 || along > 1 + 1e-9) return false;
-  const length = Math.sqrt(lengthSq);
-  return Math.abs((point.x - from.x) * dz - (point.z - from.z) * dx) / length <= tolerance;
-}
-
-/**
- * The edge a segment runs *along* when no edge runs exactly between its two
- * endpoints.
- *
- * A boolean that preserves a structural corner hands back a vertex partway
- * along an edge, and that vertex can name a node -- one a neighbouring face
- * already owns there. {@link dropInventedCorners} cannot help then: it only
- * removes corners naming no node, and this one is real and must stay, because
- * the edge it sits on is exactly what a landing there needs to split.
- *
- * So the segment names the edge that contains it instead of the edge between
- * its own endpoints. Found through the edges meeting the segment's own start
- * node, so a node's handful of edges is all that is ever examined.
- */
-function edgeAlongSegment(
-  spansAtNode: ReadonlyMap<number, readonly { readonly edge: ConstructionRegionEdge; readonly from: ConstructionGridConstraintPoint; readonly to: ConstructionGridConstraintPoint }[]>,
-  cur: ConstructionGridConstraintPoint,
-  next: ConstructionGridConstraintPoint,
-  tolerance: number,
-): ConstructionRegionEdge | undefined {
-  for (const node of [cur.source, next.source]) {
-    if (node === undefined) continue;
-    for (const span of spansAtNode.get(node) ?? []) {
-      if (onSpan(cur, span.from, span.to, tolerance) && onSpan(next, span.from, span.to, tolerance)) return span.edge;
-    }
-  }
-  return undefined;
-}
-
-/**
- * Putting back the standing nodes a straight run of the boolean's output
- * walked past.
- *
- * A node partway along a straight side adds no shape, so the boolean may hand
- * the side back without it. The engine re-inserts input points it finds on an
- * output segment, but it does so in `f32` against a fixed `1e-5`, and a point
- * the overlay snapped even slightly misses that -- which is why it happens in
- * some places and not others.
- *
- * Missing, it is a T-junction: the ground walks from one neighbour straight to
- * the other past a node the standing side still has. Flat, the two coincide
- * and nothing shows. Where that node is not at the height of the line between
- * its neighbours -- ground in a depression, on a slope -- the seam opens.
- *
- * Only a node genuinely *on* the segment, strictly between its ends, and not
- * already in this ring comes back.
- */
-function restoreSkippedNodes(
-  points: readonly ConstructionGridConstraintPoint[],
-  candidateAt: ReadonlyMap<number, { readonly x: number; readonly z: number }>,
-  buckets: ReadonlyMap<string, readonly number[]>,
-  cell: number,
-  tolerance: number,
-): readonly ConstructionGridConstraintPoint[] {
-  const inRing = new Set<number>();
-  for (const point of points) if (point.source !== undefined) inRing.add(point.source);
-
-  const result: ConstructionGridConstraintPoint[] = [];
-  for (let index = 0; index < points.length; index += 1) {
-    const from = points[index]!;
-    const to = points[(index + 1) % points.length]!;
-    result.push(from);
-
-    const dx = to.x - from.x;
-    const dz = to.z - from.z;
-    const lengthSq = dx * dx + dz * dz;
-    if (lengthSq <= 1e-12) continue;
-    const length = Math.sqrt(lengthSq);
-
-    const found: { readonly along: number; readonly source: number }[] = [];
-    const minColumn = Math.floor((Math.min(from.x, to.x) - tolerance) / cell);
-    const maxColumn = Math.floor((Math.max(from.x, to.x) + tolerance) / cell);
-    const minRow = Math.floor((Math.min(from.z, to.z) - tolerance) / cell);
-    const maxRow = Math.floor((Math.max(from.z, to.z) + tolerance) / cell);
-    for (let column = minColumn; column <= maxColumn; column += 1) {
-      for (let row = minRow; row <= maxRow; row += 1) {
-        for (const source of buckets.get(`${column}:${row}`) ?? []) {
-          if (inRing.has(source)) continue;
-          const at = candidateAt.get(source)!;
-          const along = ((at.x - from.x) * dx + (at.z - from.z) * dz) / lengthSq;
-          if (along * length <= tolerance || (1 - along) * length <= tolerance) continue;
-          if (Math.abs((at.x - from.x) * dz - (at.z - from.z) * dx) / length > tolerance) continue;
-          found.push({ along, source });
-        }
-      }
-    }
-    found.sort((a, b) => a.along - b.along);
-    for (const { source } of found) {
-      if (inRing.has(source)) continue;
-      inRing.add(source);
-      const at = candidateAt.get(source)!;
-      result.push({ x: at.x, z: at.z, source });
-    }
-  }
-  return result;
-}
-
-function dropInventedCorners(
-  points: readonly ConstructionGridConstraintPoint[],
-  hasEdge: (a: number, b: number) => boolean,
-  tolerance: number,
-): readonly ConstructionGridConstraintPoint[] {
-  const total = points.length;
-  const named: number[] = [];
-  for (let index = 0; index < total; index += 1) {
-    if (points[index]!.source !== undefined) named.push(index);
-  }
-  if (named.length < 2) return points;
-
-  const keep = new Array<boolean>(total).fill(true);
-  for (let step = 0; step < named.length; step += 1) {
-    const from = named[step]!;
-    const to = named[(step + 1) % named.length]!;
-    const between: number[] = [];
-    for (let index = (from + 1) % total; index !== to; index = (index + 1) % total) between.push(index);
-    if (between.length === 0) continue;
-
-    const a = points[from]!;
-    const b = points[to]!;
-    if (a.source === undefined || b.source === undefined || !hasEdge(a.source, b.source)) continue;
-    const dx = b.x - a.x;
-    const dz = b.z - a.z;
-    const length = Math.hypot(dx, dz);
-    if (length <= 1e-9) continue;
-
-    let allOnTheEdge = true;
-    for (const index of between) {
-      const point = points[index]!;
-      const along = ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length);
-      const off = Math.abs((point.x - a.x) * dz - (point.z - a.z) * dx) / length;
-      if (along <= 0 || along >= 1 || off > tolerance) {
-        allOnTheEdge = false;
-        break;
-      }
-    }
-    if (!allOnTheEdge) continue;
-    for (const index of between) keep[index] = false;
-  }
-
-  const kept = points.filter((_, index) => keep[index]);
-  return kept.length >= 3 ? kept : points;
-}
-
-/**
- * Giving the boolean's output its identity back.
- *
- * The boolean answers in bare floats: a corner that was a node going in
- * comes out as a pair of numbers with nothing attached. So every corner of the
- * result is matched against the corners that *did* carry a node -- the retained
- * terrain's rim and the painter's contour -- and takes that node's id.
- *
- * **This is the one place a position is matched back to a node, and it is here
- * under protest.** `terrain-constraints.ts` states the invariant it breaks. It
- * survives because the alternative is threading identity through a third-party
- * boolean that has no room for it; what it must not do is *guess badly*, and
- * three things it used to do were guesses:
- *
- * 1. **Two corners could take the same node.** Nothing checked. The engine's
- *    answer to that is not a duplicate but a collapse -- two distinct mesh
- *    edges become one, two faces walk it the same way, and the second is
- *    refused ("no room on edge"), or the cell is dropped outright for naming
- *    one node twice. Every road junction puts more nodes within snapping
- *    distance of each other, so this went from rare to routine as the network
- *    grew. Each node is now claimed at most once.
- * 2. **First come, first served.** Corners were matched in ring order, so a
- *    corner a third of a face away could take a node before the corner sitting
- *    exactly on it was ever considered. Matching is now global and ordered by
- *    distance: the true coincidence always wins, whatever order it is in.
- * 3. **Welding ran first and threw corners away before they could be
- *    matched.** A corner dropped for being close to its neighbour took its
- *    identity with it. Welding now runs last and never drops a corner that
- *    names a node.
- *
- * The search is bucketed rather than exhaustive, which is why the whole thing
- * stays linear as the road network grows instead of squaring with it.
- */
-export function buildConstraintRings(
-  targetPolygon: PlanarArea,
-  faceSize: number,
-  perimeters: ConstraintTable,
-): readonly (ConstraintRing & { readonly isHole: boolean })[] {
-  const snapDist = Math.max(0.25, faceSize * 0.18);
-
-  // One position per node, and a bucket index over them. A node appearing in
-  // two rings is one candidate, not two.
-  const candidateAt = new Map<number, { readonly x: number; readonly z: number }>();
-  for (const ring of perimeters.rings) {
-    for (const point of ring.points) {
-      if (point.source !== undefined && !candidateAt.has(point.source)) {
-        candidateAt.set(point.source, { x: point.x, z: point.z });
-      }
-    }
-  }
-  const cell = Math.max(snapDist, 1e-6);
-  const buckets = new Map<string, number[]>();
-  for (const [source, position] of candidateAt) {
-    const key = `${Math.floor(position.x / cell)}:${Math.floor(position.z / cell)}`;
-    const bucket = buckets.get(key);
-    if (bucket === undefined) buckets.set(key, [source]);
-    else bucket.push(source);
-  }
-
-  // The edge standing between two nodes, looked up once rather than searched
-  // for per corner. A pair appearing in more than one ring is the same edge
-  // seen from both sides, so the first answer is the answer.
-  const edgeBetween = new Map<string, ConstructionRegionEdge>();
-  /**
-   * The same edges, reachable from either end and carrying the span they run
-   * along, so a segment that is only *part* of an edge can still find it.
-   *
-   * Indexed by node rather than searched, and a node's degree is a handful, so
-   * this stays linear in the network's size the way the pair lookup does.
-   */
-  const spansAtNode = new Map<number, { readonly edge: ConstructionRegionEdge; readonly from: ConstructionGridConstraintPoint; readonly to: ConstructionGridConstraintPoint }[]>();
-  /** Where each standing node sits, so a pair can be tested against a span it may lie within. */
-  const positionOfSource = new Map<number, ConstructionGridConstraintPoint>();
-  for (const ring of perimeters.rings) {
-    for (const point of ring.points) {
-      if (point.source !== undefined && !positionOfSource.has(point.source)) positionOfSource.set(point.source, point);
-    }
-  }
-  for (const ring of perimeters.rings) {
-    for (let index = 0; index < ring.points.length; index += 1) {
-      const fromPoint = ring.points[index]!;
-      const toPoint = ring.points[(index + 1) % ring.points.length]!;
-      const from = fromPoint.source;
-      const to = toPoint.source;
-      const edge = ring.edges[index];
-      if (from === undefined || to === undefined || edge === undefined) continue;
-      const key = pairKey(from, to);
-      if (!edgeBetween.has(key)) edgeBetween.set(key, edge);
-      const span = { edge, from: fromPoint, to: toPoint };
-      for (const node of [from, to]) {
-        const held = spansAtNode.get(node);
-        if (held === undefined) spansAtNode.set(node, [span]);
-        else held.push(span);
-      }
-    }
-  }
-
-  // Every ring of the result, before any identity or welding.
-  const raw: { readonly isHole: boolean; readonly points: [number, number][] }[] = [];
-  for (const polygon of targetPolygon) {
-    for (let rIdx = 0; rIdx < polygon.length; rIdx += 1) {
-      const rawRing = polygon[rIdx]!;
-      const points = rawRing.slice(0, -1).map(([x, z]) => [x, z] as [number, number]);
-      if (points.length >= 3) {
-        let area = 0;
-        for (let i = 0; i < points.length; i++) {
-          const [x1, z1] = points[i]!;
-          const [x2, z2] = points[(i + 1) % points.length]!;
-          area += x1 * z2 - x2 * z1;
-        }
-        if (Math.abs(area * 0.5) >= 0.05) {
-          raw.push({ isHole: rIdx > 0, points });
-        }
-      }
-    }
-  }
-
-  // Every match anyone could make, then the closest ones first, each node and
-  // each corner taken at most once.
-  const proposals: { ring: number; point: number; source: number; distance: number }[] = [];
-  for (let ring = 0; ring < raw.length; ring += 1) {
-    const points = raw[ring]!.points;
-    for (let point = 0; point < points.length; point += 1) {
-      const [x, z] = points[point]!;
-      const column = Math.floor(x / cell);
-      const row = Math.floor(z / cell);
-      for (let dx = -1; dx <= 1; dx += 1) {
-        for (let dz = -1; dz <= 1; dz += 1) {
-          for (const source of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
-            const at = candidateAt.get(source)!;
-            const distance = Math.hypot(x - at.x, z - at.z);
-            if (distance < snapDist) proposals.push({ ring, point, source, distance });
-          }
-        }
-      }
-    }
-  }
-  proposals.sort((a, b) => a.distance - b.distance);
-
-  const takenSourceInRing = new Set<string>();
-  const takenPoint = new Set<string>();
-  const matched = new Map<string, number>();
-  for (const proposal of proposals) {
-    const at = `${proposal.ring}:${proposal.point}`;
-    const ringSource = `${proposal.ring}:${proposal.source}`;
-    if (takenSourceInRing.has(ringSource) || takenPoint.has(at)) continue;
-    takenSourceInRing.add(ringSource);
-    takenPoint.add(at);
-    matched.set(at, proposal.source);
-  }
-
-  const rings: (ConstraintRing & { readonly isHole: boolean })[] = [];
-  for (let ring = 0; ring < raw.length; ring += 1) {
-    const { isHole, points: rawPoints } = raw[ring]!;
-
-    // Welded last, and never over a corner that names a node: the whole reason
-    // to shorten a ring is that its segments are far below the face size, and
-    // a corner the ground has to meet exactly is not that.
-    const minStep = Math.max(0.18, faceSize * 0.1);
-    const points: ConstructionGridConstraintPoint[] = [];
-    for (let index = 0; index < rawPoints.length; index += 1) {
-      const source = matched.get(`${ring}:${index}`);
-      const at = source !== undefined ? candidateAt.get(source)! : { x: rawPoints[index]![0], z: rawPoints[index]![1] };
-      const previous = points[points.length - 1];
-      if (previous !== undefined) {
-        const dist = Math.hypot(at.x - previous.x, at.z - previous.z);
-        if (dist < minStep) {
-          if (source !== undefined && previous.source === undefined) {
-            points[points.length - 1] = { x: at.x, z: at.z, source };
-            continue;
-          }
-          if (source === undefined) continue;
-          if (source !== undefined && previous.source !== undefined && dist < 0.05 && !edgeBetween.has(pairKey(previous.source, source))) {
-            continue;
-          }
-        }
-      }
-      points.push(source !== undefined ? { x: at.x, z: at.z, source } : { x: at.x, z: at.z });
-    }
-    while (points.length >= 3) {
-      const last = points[points.length - 1]!;
-      const first = points[0]!;
-      if (last.source !== undefined) break;
-      if (Math.hypot(last.x - first.x, last.z - first.z) >= minStep) break;
-      points.pop();
-    }
-    if (points.length < 3) continue;
-
-    const onEdgeTolerance = Math.max(1e-6, faceSize * 0.01);
-    const restored = restoreSkippedNodes(points, candidateAt, buckets, cell, onEdgeTolerance);
-
-    // Drop collinear unnamed points that add no shape
-    let collinearCleaned = restored;
-    if (restored.length > 3) {
-      const cleaned: ConstructionGridConstraintPoint[] = [];
-      for (let i = 0; i < restored.length; i++) {
-        const prev = restored[(i - 1 + restored.length) % restored.length]!;
-        const curr = restored[i]!;
-        const next = restored[(i + 1) % restored.length]!;
-        if (curr.source === undefined) {
-          const dx = next.x - prev.x;
-          const dz = next.z - prev.z;
-          const len = Math.hypot(dx, dz);
-          if (len > 1e-6) {
-            const off = Math.abs((curr.x - prev.x) * dz - (curr.z - prev.z) * dx) / len;
-            const along = ((curr.x - prev.x) * dx + (curr.z - prev.z) * dz) / (len * len);
-            if (off < 0.08 && along > 0 && along < 1) {
-              continue;
-            }
-          }
-        }
-        cleaned.push(curr);
-      }
-      if (cleaned.length >= 3) collinearCleaned = cleaned;
-    }
-
-
-    // Two nodes answer for a run between them when an edge joins them, and
-    // equally when one edge simply *contains* them both -- a node partway
-    // along another edge is still a place that edge can be split. Without the
-    // second case the run stayed, and a segment with an unnamed point at each
-    // end had nothing to look itself up by: the tooth this dropped to one.
-    const joinedOrSpanned = (a: number, b: number): boolean => {
-      if (edgeBetween.has(pairKey(a, b))) return true;
-      const from = positionOfSource.get(a);
-      const to = positionOfSource.get(b);
-      return from !== undefined && to !== undefined &&
-        edgeAlongSegment(spansAtNode, from, to, onEdgeTolerance) !== undefined;
-    };
-    const stitched = dropInventedCorners(collinearCleaned, joinedOrSpanned, onEdgeTolerance);
-
-
-    const edges: (ConstructionRegionEdge | undefined)[] = [];
-    for (let i = 0; i < stitched.length; i++) {
-      const cur = stitched[i]!;
-      const next = stitched[(i + 1) % stitched.length]!;
-      const paired = cur.source !== undefined && next.source !== undefined
-        ? edgeBetween.get(pairKey(cur.source, next.source))
-        : undefined;
-      edges.push(paired ?? edgeAlongSegment(spansAtNode, cur, next, onEdgeTolerance));
-    }
-    rings.push({ points: stitched, edges, isHole });
-  }
-  return rings;
-}
-
 function boundsOfArea(area: StructuralCutArea): TerrainStrokeBounds {
   let minX = Infinity;
   let minZ = Infinity;
@@ -820,8 +344,9 @@ export function executeTerrainCut(
 
   const coveredKeys = new Set(covered.map((c) => c.surfaceKey.join(" ")));
 
+  const stale = new Set((request.staleRegions ?? []).map((key) => key.join(" ")));
   // The target is ground by construction above, so every ground face matches it.
-  const terrainStanding = standing.filter((topology) => hasTrait(topology.surfaceType, "ground"));
+  const terrainStanding = standing.filter((topology) => hasTrait(topology.surfaceType, "ground") && !stale.has(topology.surfaceKey.join(" ")));
   let affected = terrainStanding.filter(
     (topology) =>
       coveredKeys.has(topology.surfaceKey.join(" ")) ||
@@ -851,94 +376,34 @@ export function executeTerrainCut(
     };
   }
 
-  // **The structure standing in this ground, when there is one -- a road.**
-  //
-  // Read before anything is decided about the shape, because what it occupies
-  // is what makes the shape: the ground being laid is the affected faces
-  // *minus* this, and how much ground has to be taken in for that remainder to
-  // be layable depends on it.
-  let connectArea: PlanarArea = [];
-  let connectLoops: readonly (readonly ConstructionRegionEdge[])[] = [];
-  const connectPositions = new Map<ConstructionNodeId, { x: number; z: number }>();
-  let connectSeeds: { readonly seed: readonly string[]; readonly surfaceType: string }[] = [];
+  // **The structures standing in this ground** -- every one that cuts it
+  // (`structure-contact.ts`). Read before anything is decided about the
+  // shape, because what they occupy is what makes the shape: the ground being
+  // laid is the affected faces *minus* where they rest, and how much ground
+  // has to be taken in for that remainder to be layable depends on it.
+  let structures: StructureMeeting = NO_STRUCTURES;
   if (request.profile.kind === "regenerate" && request.profile.connectTo) {
     // Scoped to the work area. Unscoped, this reads every road on the table
     // and constrains a one-metre repair with the whole network's contour.
-    const connectReach = Math.max(standingReach, DEFAULT_FACE_SIDE * 2);
-    let connMinX = extent.minX;
-    let connMaxX = extent.maxX;
-    let connMinZ = extent.minZ;
-    let connMaxZ = extent.maxZ;
-    for (const f of affected) {
-      for (const n of f.nodes) {
-        if (n.position.x < connMinX) connMinX = n.position.x;
-        if (n.position.x > connMaxX) connMaxX = n.position.x;
-        if (n.position.z < connMinZ) connMinZ = n.position.z;
-        if (n.position.z > connMaxZ) connMaxZ = n.position.z;
-      }
-    }
-    if (request.vacatedArea) {
-      for (const piece of request.vacatedArea) {
-        for (const ring of piece) {
-          for (const [x, z] of ring) {
-            connMinX = Math.min(connMinX, x);
-            connMinZ = Math.min(connMinZ, z);
-            connMaxX = Math.max(connMaxX, x);
-            connMaxZ = Math.max(connMaxZ, z);
-          }
-        }
-      }
-    }
-    const connectType = request.profile.connectTo.surfaceType;
-    const connectTopologies = timePhase("topologias da rua", () => paintedTopologiesOf(
-      runtime as unknown as Parameters<typeof paintedTopologiesOf>[0],
-      connectType,
-      {
-        minX: connMinX - connectReach,
-        minZ: connMinZ - connectReach,
-        maxX: connMaxX + connectReach,
-        maxZ: connMaxZ + connectReach,
-      },
-    ));
-    const { paintedNodes, paintedLoops } = timePhase("perímetro da rua", () => paintedFalloutOf(connectTopologies));
-    for (const n of paintedNodes) connectPositions.set(n.id, { x: n.position.x, z: n.position.z });
-
-    // **The area it occupies is a union of its faces, never its perimeter
-    // rings.** `outwardPerimeterRings` answers with every free-boundary ring
-    // of the set undifferentiated -- the cloud's outer contour and any ring
-    // around a gap *inside* it, with nothing saying which is which. Subtracting
-    // each of those as a solid polygon carves the gaps out of the terrain too,
-    // and a gap inside a road that also gets no ground is a hole in the road.
-    // Unioning the faces themselves produces the same outline with its holes
-    // correctly holes.
-    const facePolygons = connectTopologies
-      .map((topology) => topologyToPolygonWithHoles(topology, connectPositions))
-      .filter((polygon) => polygon.length > 0);
-    if (facePolygons.length > 0) {
-      try {
-        connectArea = timePhase(`união da rua (${facePolygons.length} faces)`, () => planarUnion(runtime, facePolygons[0]!, ...facePolygons.slice(1)));
-      } catch {
-        connectArea = [];
-      }
-    }
-
-
-    // The loops stay, separately, for identity: they are what the subtraction's
-    // bare-float output is matched back against, so the ground comes back
-    // meeting the road at its actual nodes and edges rather than at coincident
-    // positions. They are numbered later, once, alongside the retained rim --
-    // the generator answers with a single index per corner and knows nothing
-    // of which ring it came from.
-    connectLoops = paintedLoops;
-    connectSeeds = connectTopologies.map((topology) => ({
-      seed: topology.surfaceKey,
-      surfaceType: topology.surfaceType,
-    }));
+    const reach = Math.max(standingReach, DEFAULT_FACE_SIDE * 2);
+    let minX = extent.minX, maxX = extent.maxX, minZ = extent.minZ, maxZ = extent.maxZ;
+    const include = (x: number, z: number) => {
+      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
+    };
+    for (const face of affected) for (const node of face.nodes) include(node.position.x, node.position.z);
+    for (const piece of request.vacatedArea ?? []) for (const ring of piece) for (const [x, z] of ring) include(x, z);
+    structures = meetStructures(runtime, { minX: minX - reach, minZ: minZ - reach, maxX: maxX + reach, maxZ: maxZ + reach }, targetSurfaceType, terrainStanding);
   }
+  const connectArea = structures.area;
 
   /** The affected faces as one polygon, with `connectArea` taken out of it. */
   const groundFor = (faces: readonly ConstructionRegionTopology[]): PlanarArea => {
-    const polygons = faces.map(topologyToPolygon).filter((p) => p.length > 0);
+    // A face an edit dragged out of place -- rimmed by a node the structure
+    // carried away -- never counts by its shape: that runs from where it lay to
+    // where the node went, over ground nobody touched, and laying ground there
+    // leaves a trail behind the structure. Where it lay comes in as vacated.
+    const stale = new Set((request.staleRegions ?? []).map((key) => key.join(" ")));
+    const polygons = faces.filter((face) => !stale.has(face.surfaceKey.join(" "))).map(topologyToPolygon).filter((p) => p.length > 0);
     const allPolygons =
       request.vacatedArea && request.vacatedArea.length > 0
         ? [...polygons, ...request.vacatedArea]
@@ -998,7 +463,7 @@ export function executeTerrainCut(
 
       affected = [...affected, ...absorbed];
       affectedKeys = new Set(affected.map((t) => t.surfaceKey.join(" ")));
-      retained = terrainStanding.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")));
+      retained = terrainStanding.filter((t) => !affectedKeys.has(t.surfaceKey.join(" ")) && !stale.has(t.surfaceKey.join(" ")));
       targetPolygon = timePhase(`chão a regerar com vizinhas (${affected.length} faces)`, () => groundFor(affected));
     }
   }
@@ -1017,18 +482,14 @@ export function executeTerrainCut(
   // One numbering across the retained rim and the connected structure, because
   // the generator answers with one `source` index per corner.
   const retainedPerimeters = timePhase(`perímetro do terreno retido (${retained.length} faces)`, () => perimeterConstraints(retained, 0));
-  const connectTable = constraintsFromRings(
-    connectLoops,
-    (nodeId) => connectPositions.get(nodeId),
-    retainedPerimeters.sources.length,
-  );
+  const connectTable = structures.constraints(retainedPerimeters.sources.length);
   const perimeters: ConstraintTable = {
     rings: [...retainedPerimeters.rings, ...connectTable.rings],
     sources: [...retainedPerimeters.sources, ...connectTable.sources],
   };
   const extraHoleRings: ConstraintRing[] = [];
 
-  const targetRings = timePhase("anéis de restrição", () => buildConstraintRings(targetPolygon, effectiveFaceSide, perimeters));
+  const targetRings = timePhase("anéis de restrição", () => buildConstraintRings(targetPolygon, effectiveFaceSide, perimeters, structures.liesOnSide));
   const boundaryRings = targetRings.filter((r) => !r.isHole && r.points.length >= 3);
   const holeRings = [...targetRings.filter((r) => r.isHole && r.points.length >= 3), ...extraHoleRings];
 
@@ -1047,17 +508,31 @@ export function executeTerrainCut(
   const extentRadius = Math.max((coveredExtent.maxX - coveredExtent.minX) / 2, (coveredExtent.maxZ - coveredExtent.minZ) / 2, effectiveFaceSide);
   const radius = request.area.radius ?? extentRadius;
 
-  const standingNodes = terrainStanding.flatMap((topology) => topology.nodes.map((node) => node.position));
+  // **The ground's own heights, never a structure's.** New ground lies where
+  // the ground lay; it meets a structure only at the nodes it shares with it
+  // -- its corners on the structure's sides -- instead of being drawn up
+  // toward it all round, into a bank that is left standing in the air when
+  // the structure moves on.
+  const standingNodes = terrainStanding.flatMap((topology) => topology.nodes).filter((node) => !structures.holds(node.id)).map((node) => node.position);
   const localReach = effectiveFaceSide * 2.0;
   const wideReach = Math.max(effectiveFaceSide * 3, radius);
   const localKept = heightFieldOf(standingNodes, localReach);
   const wideKept = heightFieldOf(standingNodes, wideReach);
+  // Over a face of the ground, the height that face is drawn at -- never a
+  // blend of nodes metres away, which on coarse ground over a hill sinks the
+  // new ground below the old, and its seam with a structure through its side.
+  // A face an edit dragged out of shape is no drawing of the ground at all.
+  const staleShapes = new Set((request.staleRegions ?? []).map((key) => key.join(" ")));
+  const structureNodes = new Set(terrainStanding.flatMap((topology) => topology.nodes).filter((node) => structures.holds(node.id)).map((node) => node.id));
+  const drawnGround = groundSurfaceOf(terrainStanding.filter((topology) => !staleShapes.has(topology.surfaceKey.join(" "))), structureNodes);
 
   const strokePath = request.area.path;
   const centerOrPath = strokePath && strokePath.length > 0 ? strokePath : center;
 
   const sampleBase = (point: { readonly x: number; readonly z: number }): number => {
-    let base = localKept.at(point);
+    const meeting = structures.heightAt(point);
+    if (meeting !== undefined) return meeting;
+    let base = drawnGround(point) ?? localKept.at(point);
     if (base === undefined) {
       base = wideKept.at(point);
     }
@@ -1131,7 +606,13 @@ export function executeTerrainCut(
     boundary: boundaryRings,
     holes: holeRings,
     sources: perimeters.sources,
-    replaceSurfaceKeys: affected.length > 0 ? affected.map((f) => f.surfaceKey) : undefined,
+    replaceSurfaceKeys:
+      affected.length > 0 || (request.vacatedArea && request.staleRegions && request.staleRegions.length > 0)
+        ? [
+            ...affected.map((f) => f.surfaceKey),
+            ...(request.vacatedArea ? ((request.staleRegions ?? []) as readonly ConstructionSurfaceKey[]) : []),
+          ]
+        : undefined,
     // The road belongs here as much as the retained terrain does. These seeds
     // are what `fillTerrain` reads back to learn which edges already have a
     // face on them and which way that face walks; a road left out of them is a
@@ -1139,7 +620,7 @@ export function executeTerrainCut(
     // is refused for walking one the wrong way.
     topologySeeds: [
       ...retained.map((topology) => ({ seed: topology.surfaceKey, surfaceType: topology.surfaceType })),
-      ...connectSeeds,
+      ...structures.seeds,
     ],
     avoidArea: connectArea,
     heightAt,
```

### `apps/vtt/src/composition/tabletop/terrain/structure-contact.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/terrain/structure-contact.ts b/apps/vtt/src/composition/tabletop/terrain/structure-contact.ts
new file mode 100644
index 00000000..b761acaf
--- /dev/null
+++ b/apps/vtt/src/composition/tabletop/terrain/structure-contact.ts
@@ -0,0 +1,233 @@
+import type { ConstructionNodeId, ConstructionPosition, ConstructionRegionEdge, ConstructionRegionTopology, ConstructionTopologyBoundsQuery } from "@/ports";
+import type { PlanarArea, PlanarPolygon } from "@/features/edit-construction";
+import {
+  faceRings,
+  GROUND_CONTACT_CELL,
+  GROUND_CONTACT_CLEARANCE,
+  GROUND_SIDE_REST_ROOM,
+  groundContactOf,
+  groundSurfaceOf,
+  insideRing,
+  isGroundType,
+  nearestOnSegment,
+  planarDifference,
+  planarUnion,
+  resolveCreationInteraction,
+  structureTypeFor,
+  surfaceHeightOf,
+} from "../../../features/edit-construction/index.ts";
+
+import { anchoredConstraints } from "./constraint-rings.ts";
+import type { ConstraintTable } from "./terrain-constraints.ts";
+import type { TerrainCutRuntime } from "./terrain-neighborhood.ts";
+import { paintedFalloutOf } from "../interference/painted-topologies.ts";
+import { timePhase } from "../commit-timing.ts";
+
+/**
+ * How the ground laid again in a repair meets the structures standing in it
+ * -- every one that cuts the ground there, not only the one that changed, so
+ * the ground laid round one never runs over another standing beside it.
+ *
+ * - **Where:** the part of each face resting on the ground
+ *   (`topology/ground-contact.ts`), which the ground goes round; the ground
+ *   runs on under the rest.
+ * - **At which nodes:** a structure's corners the ground may take as its own
+ *   -- those resting on it; a sealed structure only where another holds the
+ *   node too -- and the sides it may split.
+ * - **At what height:** a ground corner on a sealed structure's side takes the
+ *   side's height; one on the line the cut ends at under a structure lies on
+ *   its underside.
+ *
+ * Nothing here asks what any structure is: whether it cuts is its type's
+ * declared interaction with the ground, whether it is sealed its declared
+ * capability.
+ */
+export interface StructureMeeting {
+  /** Where the structures rest on the ground: the area the ground goes round. */
+  readonly area: PlanarArea;
+  /** The structures, as the fill reads back which edges already have a face on them. */
+  readonly seeds: readonly { readonly seed: readonly string[]; readonly surfaceType: string }[];
+  /** Whether a node is a structure's -- never a height the ground should take. */
+  holds(nodeId: ConstructionNodeId): boolean;
+  /** The structures' outlines as constraint rings, numbered from `startingIndex`. */
+  constraints(startingIndex: number): ConstraintTable;
+  /** Whether a point lies on a structure's side: where the ground meets it, never snapped away from it. */
+  liesOnSide(point: { readonly x: number; readonly z: number }): boolean;
+  /** The height the ground must take at a point meeting a structure -- on a sealed side, or on the cut line under a face -- if it meets one. */
+  heightAt(point: { readonly x: number; readonly z: number }): number | undefined;
+}
+
+/** No structure in the ground: nothing to go round, nothing to meet. */
+export const NO_STRUCTURES: StructureMeeting = Object.freeze({
+  area: [],
+  seeds: [],
+  holds: () => false,
+  constraints: () => ({ rings: [], sources: [] }),
+  liesOnSide: () => false,
+  heightAt: () => undefined,
+});
+
+type Side = { readonly a: ConstructionPosition; readonly b: ConstructionPosition };
+
+/** How near a point must lie to a line to lie on it. */
+const ON = 1e-3;
+
+function polygonOf(topology: ConstructionRegionTopology, positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>): PlanarPolygon {
+  const ringOf = (loop: readonly ConstructionRegionEdge[]) => {
+    const ring = loop.map((use) => positionOf.get(use.startNodeId)).filter((p): p is { x: number; z: number } => p !== undefined).map((p) => [p.x, p.z] as [number, number]);
+    return ring.length >= 3 ? [...ring, ring[0]!] : undefined;
+  };
+  const outer = topology.outerLoops[0] && ringOf(topology.outerLoops[0]);
+  if (!outer) return [];
+  return [outer, ...topology.holes.map(ringOf).filter((ring): ring is [number, number][] => ring !== undefined)];
+}
+
+/**
+ * The structures standing in the ground within `bounds`, and how the ground
+ * about to be laid there meets them. `terrainStanding` is the ground around,
+ * read for the ground's own height.
+ */
+export function meetStructures(
+  runtime: TerrainCutRuntime,
+  bounds: ConstructionTopologyBoundsQuery,
+  groundType: string,
+  terrainStanding: readonly ConstructionRegionTopology[],
+): StructureMeeting {
+  const standingHere = timePhase("estruturas no lugar", () => runtime.getRegionTopologiesInBounds(bounds));
+  const structures = standingHere.filter((topology) => !isGroundType(topology.surfaceType));
+  const cutting = structures.filter((topology) => resolveCreationInteraction(topology.surfaceType, groundType).kind === "cut");
+  const positions = new Map<ConstructionNodeId, { x: number; z: number }>();
+  for (const topology of cutting) for (const node of topology.nodes) positions.set(node.id, { x: node.position.x, z: node.position.z });
+
+  // Which types hold each node: a node another type holds too is a join -- a
+  // ramp's end welded into a floor -- and the side between two of them has
+  // that structure on its far side, so no ground fits under it.
+  const holders = new Map<ConstructionNodeId, Set<string>>();
+  for (const topology of structures) {
+    for (const node of topology.nodes) {
+      const types = holders.get(node.id) ?? new Set<string>();
+      types.add(topology.surfaceType);
+      holders.set(node.id, types);
+    }
+  }
+  const heldByOthers = new Map<string, ReadonlySet<ConstructionNodeId>>();
+  const heldFor = (surfaceType: string): ReadonlySet<ConstructionNodeId> => {
+    let held = heldByOthers.get(surfaceType);
+    if (held === undefined) {
+      held = new Set([...holders].filter(([, types]) => [...types].some((type) => type !== surfaceType)).map(([id]) => id));
+      heldByOthers.set(surfaceType, held);
+    }
+    return held;
+  };
+
+  // **The area they occupy is a union of their faces, never their perimeter
+  // rings** -- a perimeter walk cannot tell a gap inside a road from its
+  // outside, and would carve the gap out of the ground too -- and **only
+  // where each rests on the ground**, read from the ground alone, never from
+  // the structures' nodes it shares.
+  const groundAt = groundSurfaceOf(terrainStanding, new Set(positions.keys()));
+  // A structure standing clear of the ground all over is no business of the
+  // ground's: nothing is cut round it, its outline is no line the ground meets.
+  const meeting: ConstructionRegionTopology[] = [];
+  const pieces = cutting.flatMap((topology): (PlanarPolygon | PlanarArea)[] => {
+    const polygon = polygonOf(topology, positions);
+    if (polygon.length === 0) return [];
+    const contact = groundContactOf(topology, groundAt, GROUND_CONTACT_CELL, GROUND_CONTACT_CLEARANCE, heldFor(topology.surfaceType));
+    if (contact.kind === "none") return [];
+    meeting.push(topology);
+    if (contact.kind === "whole") return [polygon];
+    try {
+      const clear = planarUnion(runtime, [contact.clear[0]!.map(([x, z]) => [x, z] as [number, number])], ...contact.clear.slice(1).map((cell) => [cell.map(([x, z]) => [x, z] as [number, number])]));
+      return [planarDifference(runtime, polygon, clear)];
+    } catch {
+      return [polygon];
+    }
+  }).filter((piece) => piece.length > 0);
+  let area: PlanarArea = [];
+  if (pieces.length > 0) {
+    try {
+      area = timePhase(`união das estruturas (${pieces.length} faces)`, () => planarUnion(runtime, pieces[0]!, ...pieces.slice(1)));
+    } catch {
+      area = [];
+    }
+  }
+
+  // Their outlines, for identity: what the subtraction's bare-float output is
+  // matched back against, so the ground comes back meeting each structure at
+  // its actual nodes and edges -- except a sealed one, met only at the nodes
+  // it holds with another.
+  const byType = new Map<string, ConstructionRegionTopology[]>();
+  for (const topology of meeting) byType.set(topology.surfaceType, [...(byType.get(topology.surfaceType) ?? []), topology]);
+  const sharedLoops: (readonly ConstructionRegionEdge[])[] = [];
+  const sealedLoops: (readonly ConstructionRegionEdge[])[] = [];
+  const sealedHeld = new Set<ConstructionNodeId>();
+  const sides: Side[] = [];
+  const sealedSides: Side[] = [];
+  for (const [surfaceType, faces] of byType) {
+    const { paintedLoops } = timePhase("perímetro das estruturas", () => paintedFalloutOf(faces));
+    const sealed = structureTypeFor(surfaceType)?.sealedOutline === true;
+    for (const topology of faces) {
+      const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
+      for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
+        const side = { a: at.get(use.startNodeId)!, b: at.get(use.endNodeId)! };
+        sides.push(side);
+        if (sealed) sealedSides.push(side);
+      }
+    }
+    if (!sealed) {
+      sharedLoops.push(...paintedLoops);
+      continue;
+    }
+    sealedLoops.push(...paintedLoops);
+    for (const id of heldFor(surfaceType)) if (faces.some((face) => face.nodes.some((node) => node.id === id))) sealedHeld.add(id);
+  }
+
+  // The nodes the ground may take as its own corners: those resting on it, and
+  // those another structure holds too. A node standing clear of the ground --
+  // a floor's corner moved out over a valley -- is no corner of the ground's,
+  // however near it is in plan.
+  const resting = new Set<ConstructionNodeId>();
+  for (const topology of cutting) {
+    for (const node of topology.nodes) {
+      const ground = groundAt(node.position);
+      if (ground !== undefined && node.position.y <= ground + GROUND_CONTACT_CLEARANCE + GROUND_SIDE_REST_ROOM) resting.add(node.id);
+    }
+    for (const id of heldFor(topology.surfaceType)) if (topology.nodes.some((node) => node.id === id)) resting.add(id);
+  }
+
+  // The faces' own surfaces, for the line the cut ends at under one.
+  const undersides = cutting.flatMap((topology) => {
+    const surfaceAt = surfaceHeightOf(topology);
+    const ring = faceRings(topology)[0] ?? [];
+    return surfaceAt && ring.length >= 3 ? [{ ring, surfaceAt }] : [];
+  });
+  const cutLine = area.flatMap((piece) => piece.flatMap((ring) => ring.slice(0, -1).map((a, index) => [{ x: a[0], z: a[1] }, { x: ring[index + 1]![0], z: ring[index + 1]![1] }] as const)));
+
+  return {
+    area,
+    seeds: cutting.map((topology) => ({ seed: topology.surfaceKey, surfaceType: topology.surfaceType })),
+    holds: (nodeId) => positions.has(nodeId),
+    constraints(startingIndex) {
+      const shared = anchoredConstraints(sharedLoops, positions, startingIndex, resting, [], true);
+      const sealed = anchoredConstraints(sealedLoops, positions, startingIndex, sealedHeld, shared.sources);
+      return { rings: [...shared.rings, ...sealed.rings], sources: [...shared.sources, ...sealed.sources] };
+    },
+    liesOnSide: (point) => sides.some(({ a, b }) => nearestOnSegment(point, a, b).distance < ON),
+    heightAt(point) {
+      // On a sealed side resting on the ground: the side's height. Over the
+      // ground, clear of it, the ground passes under at its own height; the
+      // point where resting gives way is on the line itself, so it has room.
+      for (const { a, b } of sealedSides) {
+        const nearest = nearestOnSegment(point, a, b);
+        if (nearest.distance >= ON) continue;
+        const y = a.y + (b.y - a.y) * nearest.t;
+        const ground = groundAt(point);
+        if (ground === undefined || y <= ground + GROUND_CONTACT_CLEARANCE + GROUND_SIDE_REST_ROOM) return y;
+      }
+      // On the line the cut ends at under a face: on the face's underside.
+      if (undersides.length === 0 || !cutLine.some(([a, b]) => nearestOnSegment(point, a, b).distance < ON)) return undefined;
+      const under = undersides.find(({ ring }) => insideRing(ring, point) || ring.some((a, index) => nearestOnSegment(point, a, ring[(index + 1) % ring.length]!).distance < ON));
+      return under?.surfaceAt(point);
+    },
+  };
+}
```

### `apps/vtt/src/composition/tabletop/terrain/constraint-rings.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/terrain/constraint-rings.ts b/apps/vtt/src/composition/tabletop/terrain/constraint-rings.ts
new file mode 100644
index 00000000..b74bf868
--- /dev/null
+++ b/apps/vtt/src/composition/tabletop/terrain/constraint-rings.ts
@@ -0,0 +1,497 @@
+import type { ConstructionGridConstraintPoint, ConstructionNodeId, ConstructionRegionEdge } from "@/ports";
+import type { PlanarArea } from "@/features/edit-construction";
+
+import type { ConstraintRing, ConstraintTable } from "./terrain-constraints.ts";
+
+/**
+ * The rings a repair hands the grid generator, and what each corner and side
+ * of them is: which node a corner is, which standing edge a side runs along --
+ * so the ground laid comes back meeting what stands at its real nodes and
+ * edges, never at coincident positions. Read from the boolean's bare output
+ * (`buildConstraintRings`) and from a structure's own outline
+ * (`anchoredConstraints`).
+ */
+
+/**
+ * A structure's outline as constraint rings where a corner carries its node
+ * only when `anchored` names it. Sealed, the ground meets it without sharing it
+ * -- no edge to split, and a node only where another structure holds it too,
+ * a ramp's end welded into a floor. Otherwise (`withEdges`) its sides stay
+ * edges the ground may split, and `anchored` is the nodes resting on the ground.
+ */
+export function anchoredConstraints(
+  rings: readonly (readonly ConstructionRegionEdge[])[],
+  positionOf: ReadonlyMap<ConstructionNodeId, { readonly x: number; readonly z: number }>,
+  startingIndex: number,
+  anchored: ReadonlySet<ConstructionNodeId>,
+  /** Sources numbered just before, from `startingIndex` on: a node already among them keeps its number. */
+  before: readonly ConstructionNodeId[] = [],
+  withEdges = false,
+): ConstraintTable {
+  const sources: ConstructionNodeId[] = [];
+  const index = new Map<ConstructionNodeId, number>(before.map((id, i) => [id, startingIndex + i]));
+  startingIndex += before.length;
+  const built: ConstraintRing[] = [];
+  for (const ring of rings) {
+    const points: ConstructionGridConstraintPoint[] = [];
+    for (const edge of ring) {
+      const position = positionOf.get(edge.startNodeId);
+      if (!position) break;
+      let source: number | undefined;
+      if (anchored.has(edge.startNodeId)) {
+        source = index.get(edge.startNodeId);
+        if (source === undefined) {
+          source = startingIndex + sources.length;
+          sources.push(edge.startNodeId);
+          index.set(edge.startNodeId, source);
+        }
+      }
+      points.push(source === undefined ? { x: position.x, z: position.z } : { x: position.x, z: position.z, source });
+    }
+    if (points.length === ring.length && points.length >= 3) built.push({ points, edges: withEdges ? ring : ring.map(() => undefined) });
+  }
+  return { rings: built, sources };
+}
+
+/** Two nodes name one edge whichever way round they are given. */
+function pairKey(a: number, b: number): string {
+  return a < b ? `${a}:${b}` : `${b}:${a}`;
+}
+
+/**
+ * Dropping corners the boolean invented in the middle of an edge that already
+ * existed.
+ *
+ * Where the ground's own rim crosses the painter's contour, the boolean
+ * splits both and hands back a vertex at the crossing. That vertex names no
+ * node -- it never was one -- and its presence breaks one segment into two,
+ * *neither* of which runs between a pair of adjacent nodes any more. So neither
+ * knows which edge it lies on, and every corner the generator later lands there
+ * is discarded with nothing split: the ground meets the painter at a coincident
+ * position instead of at a node, once per crossing. That is the tooth.
+ *
+ * A corner sitting on the straight line between two nodes that really are
+ * joined by an edge adds nothing the ring did not already say. Removing it
+ * restores the segment to the pair it belongs to, and the split lands where it
+ * should. Only a corner that is genuinely *on* that line goes -- one where the
+ * rim leaves the contour is a real corner and stays.
+ */
+/** Whether `point` sits on the span `from`-`to`, ends included, within `tolerance`. */
+function onSpan(
+  point: { readonly x: number; readonly z: number },
+  from: { readonly x: number; readonly z: number },
+  to: { readonly x: number; readonly z: number },
+  tolerance: number,
+): boolean {
+  const dx = to.x - from.x;
+  const dz = to.z - from.z;
+  const lengthSq = dx * dx + dz * dz;
+  if (lengthSq <= 1e-12) return false;
+  const along = ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSq;
+  if (along < -1e-9 || along > 1 + 1e-9) return false;
+  const length = Math.sqrt(lengthSq);
+  return Math.abs((point.x - from.x) * dz - (point.z - from.z) * dx) / length <= tolerance;
+}
+
+/**
+ * The edge a segment runs *along* when no edge runs exactly between its two
+ * endpoints.
+ *
+ * A boolean that preserves a structural corner hands back a vertex partway
+ * along an edge, and that vertex can name a node -- one a neighbouring face
+ * already owns there. {@link dropInventedCorners} cannot help then: it only
+ * removes corners naming no node, and this one is real and must stay, because
+ * the edge it sits on is exactly what a landing there needs to split.
+ *
+ * So the segment names the edge that contains it instead of the edge between
+ * its own endpoints. Found through the edges meeting the segment's own start
+ * node, so a node's handful of edges is all that is ever examined.
+ */
+function edgeAlongSegment(
+  spansAtNode: ReadonlyMap<number, readonly { readonly edge: ConstructionRegionEdge; readonly from: ConstructionGridConstraintPoint; readonly to: ConstructionGridConstraintPoint }[]>,
+  cur: ConstructionGridConstraintPoint,
+  next: ConstructionGridConstraintPoint,
+  tolerance: number,
+): ConstructionRegionEdge | undefined {
+  for (const node of [cur.source, next.source]) {
+    if (node === undefined) continue;
+    for (const span of spansAtNode.get(node) ?? []) {
+      if (onSpan(cur, span.from, span.to, tolerance) && onSpan(next, span.from, span.to, tolerance)) return span.edge;
+    }
+  }
+  return undefined;
+}
+
+/**
+ * Putting back the standing nodes a straight run of the boolean's output
+ * walked past.
+ *
+ * A node partway along a straight side adds no shape, so the boolean may hand
+ * the side back without it. The engine re-inserts input points it finds on an
+ * output segment, but it does so in `f32` against a fixed `1e-5`, and a point
+ * the overlay snapped even slightly misses that -- which is why it happens in
+ * some places and not others.
+ *
+ * Missing, it is a T-junction: the ground walks from one neighbour straight to
+ * the other past a node the standing side still has. Flat, the two coincide
+ * and nothing shows. Where that node is not at the height of the line between
+ * its neighbours -- ground in a depression, on a slope -- the seam opens.
+ *
+ * Only a node genuinely *on* the segment, strictly between its ends, and not
+ * already in this ring comes back.
+ */
+function restoreSkippedNodes(
+  points: readonly ConstructionGridConstraintPoint[],
+  candidateAt: ReadonlyMap<number, { readonly x: number; readonly z: number }>,
+  buckets: ReadonlyMap<string, readonly number[]>,
+  cell: number,
+  tolerance: number,
+): readonly ConstructionGridConstraintPoint[] {
+  const inRing = new Set<number>();
+  for (const point of points) if (point.source !== undefined) inRing.add(point.source);
+
+  const result: ConstructionGridConstraintPoint[] = [];
+  for (let index = 0; index < points.length; index += 1) {
+    const from = points[index]!;
+    const to = points[(index + 1) % points.length]!;
+    result.push(from);
+
+    const dx = to.x - from.x;
+    const dz = to.z - from.z;
+    const lengthSq = dx * dx + dz * dz;
+    if (lengthSq <= 1e-12) continue;
+    const length = Math.sqrt(lengthSq);
+
+    const found: { readonly along: number; readonly source: number }[] = [];
+    const minColumn = Math.floor((Math.min(from.x, to.x) - tolerance) / cell);
+    const maxColumn = Math.floor((Math.max(from.x, to.x) + tolerance) / cell);
+    const minRow = Math.floor((Math.min(from.z, to.z) - tolerance) / cell);
+    const maxRow = Math.floor((Math.max(from.z, to.z) + tolerance) / cell);
+    for (let column = minColumn; column <= maxColumn; column += 1) {
+      for (let row = minRow; row <= maxRow; row += 1) {
+        for (const source of buckets.get(`${column}:${row}`) ?? []) {
+          if (inRing.has(source)) continue;
+          const at = candidateAt.get(source)!;
+          const along = ((at.x - from.x) * dx + (at.z - from.z) * dz) / lengthSq;
+          if (along * length <= tolerance || (1 - along) * length <= tolerance) continue;
+          if (Math.abs((at.x - from.x) * dz - (at.z - from.z) * dx) / length > tolerance) continue;
+          found.push({ along, source });
+        }
+      }
+    }
+    found.sort((a, b) => a.along - b.along);
+    for (const { source } of found) {
+      if (inRing.has(source)) continue;
+      inRing.add(source);
+      const at = candidateAt.get(source)!;
+      result.push({ x: at.x, z: at.z, source });
+    }
+  }
+  return result;
+}
+
+function dropInventedCorners(
+  points: readonly ConstructionGridConstraintPoint[],
+  hasEdge: (a: number, b: number) => boolean,
+  tolerance: number,
+): readonly ConstructionGridConstraintPoint[] {
+  const total = points.length;
+  const named: number[] = [];
+  for (let index = 0; index < total; index += 1) {
+    if (points[index]!.source !== undefined) named.push(index);
+  }
+  if (named.length < 2) return points;
+
+  const keep = new Array<boolean>(total).fill(true);
+  for (let step = 0; step < named.length; step += 1) {
+    const from = named[step]!;
+    const to = named[(step + 1) % named.length]!;
+    const between: number[] = [];
+    for (let index = (from + 1) % total; index !== to; index = (index + 1) % total) between.push(index);
+    if (between.length === 0) continue;
+
+    const a = points[from]!;
+    const b = points[to]!;
+    if (a.source === undefined || b.source === undefined || !hasEdge(a.source, b.source)) continue;
+    const dx = b.x - a.x;
+    const dz = b.z - a.z;
+    const length = Math.hypot(dx, dz);
+    if (length <= 1e-9) continue;
+
+    let allOnTheEdge = true;
+    for (const index of between) {
+      const point = points[index]!;
+      const along = ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length);
+      const off = Math.abs((point.x - a.x) * dz - (point.z - a.z) * dx) / length;
+      if (along <= 0 || along >= 1 || off > tolerance) {
+        allOnTheEdge = false;
+        break;
+      }
+    }
+    if (!allOnTheEdge) continue;
+    for (const index of between) keep[index] = false;
+  }
+
+  const kept = points.filter((_, index) => keep[index]);
+  return kept.length >= 3 ? kept : points;
+}
+
+/**
+ * Giving the boolean's output its identity back.
+ *
+ * The boolean answers in bare floats: a corner that was a node going in
+ * comes out as a pair of numbers with nothing attached. So every corner of the
+ * result is matched against the corners that *did* carry a node -- the retained
+ * terrain's rim and the painter's contour -- and takes that node's id.
+ *
+ * **This is the one place a position is matched back to a node, and it is here
+ * under protest.** `terrain-constraints.ts` states the invariant it breaks. It
+ * survives because the alternative is threading identity through a third-party
+ * boolean that has no room for it; what it must not do is *guess badly*, and
+ * three things it used to do were guesses:
+ *
+ * 1. **Two corners could take the same node.** Nothing checked. The engine's
+ *    answer to that is not a duplicate but a collapse -- two distinct mesh
+ *    edges become one, two faces walk it the same way, and the second is
+ *    refused ("no room on edge"), or the cell is dropped outright for naming
+ *    one node twice. Every road junction puts more nodes within snapping
+ *    distance of each other, so this went from rare to routine as the network
+ *    grew. Each node is now claimed at most once.
+ * 2. **First come, first served.** Corners were matched in ring order, so a
+ *    corner a third of a face away could take a node before the corner sitting
+ *    exactly on it was ever considered. Matching is now global and ordered by
+ *    distance: the true coincidence always wins, whatever order it is in.
+ * 3. **Welding ran first and threw corners away before they could be
+ *    matched.** A corner dropped for being close to its neighbour took its
+ *    identity with it. Welding now runs last and never drops a corner that
+ *    names a node.
+ *
+ * The search is bucketed rather than exhaustive, which is why the whole thing
+ * stays linear as the road network grows instead of squaring with it.
+ */
+export function buildConstraintRings(
+  targetPolygon: PlanarArea,
+  faceSize: number,
+  perimeters: ConstraintTable,
+  /**
+   * Whether a corner lies on a structure's side -- where the ground meets it,
+   * a place a cut gave way partway along it. Such a corner is exactly where
+   * the ground must meet that side, so it takes a node only standing right
+   * there, never one snapped to from beside it.
+   */
+  pinned: (point: { readonly x: number; readonly z: number }) => boolean = () => false,
+): readonly (ConstraintRing & { readonly isHole: boolean })[] {
+  const snapDist = Math.max(0.25, faceSize * 0.18);
+
+  // One position per node, and a bucket index over them. A node appearing in
+  // two rings is one candidate, not two.
+  const candidateAt = new Map<number, { readonly x: number; readonly z: number }>();
+  for (const ring of perimeters.rings) {
+    for (const point of ring.points) {
+      if (point.source !== undefined && !candidateAt.has(point.source)) {
+        candidateAt.set(point.source, { x: point.x, z: point.z });
+      }
+    }
+  }
+  const cell = Math.max(snapDist, 1e-6);
+  const buckets = new Map<string, number[]>();
+  for (const [source, position] of candidateAt) {
+    const key = `${Math.floor(position.x / cell)}:${Math.floor(position.z / cell)}`;
+    const bucket = buckets.get(key);
+    if (bucket === undefined) buckets.set(key, [source]);
+    else bucket.push(source);
+  }
+
+  // The edge standing between two nodes, looked up once rather than searched
+  // for per corner. A pair appearing in more than one ring is the same edge
+  // seen from both sides, so the first answer is the answer.
+  const edgeBetween = new Map<string, ConstructionRegionEdge>();
+  /**
+   * The same edges, reachable from either end and carrying the span they run
+   * along, so a segment that is only *part* of an edge can still find it.
+   *
+   * Indexed by node rather than searched, and a node's degree is a handful, so
+   * this stays linear in the network's size the way the pair lookup does.
+   */
+  const spansAtNode = new Map<number, { readonly edge: ConstructionRegionEdge; readonly from: ConstructionGridConstraintPoint; readonly to: ConstructionGridConstraintPoint }[]>();
+  /** Where each standing node sits, so a pair can be tested against a span it may lie within. */
+  const positionOfSource = new Map<number, ConstructionGridConstraintPoint>();
+  for (const ring of perimeters.rings) {
+    for (const point of ring.points) {
+      if (point.source !== undefined && !positionOfSource.has(point.source)) positionOfSource.set(point.source, point);
+    }
+  }
+  for (const ring of perimeters.rings) {
+    for (let index = 0; index < ring.points.length; index += 1) {
+      const fromPoint = ring.points[index]!;
+      const toPoint = ring.points[(index + 1) % ring.points.length]!;
+      const from = fromPoint.source;
+      const to = toPoint.source;
+      const edge = ring.edges[index];
+      // A side with only one end the ground may take -- a structure's side
+      // running from where it rests out to where it stands clear -- is still
+      // a side a corner partway along it can split.
+      if (edge === undefined || (from === undefined && to === undefined)) continue;
+      if (from !== undefined && to !== undefined) {
+        const key = pairKey(from, to);
+        if (!edgeBetween.has(key)) edgeBetween.set(key, edge);
+      }
+      const span = { edge, from: fromPoint, to: toPoint };
+      for (const node of [from, to]) {
+        if (node === undefined) continue;
+        const held = spansAtNode.get(node);
+        if (held === undefined) spansAtNode.set(node, [span]);
+        else held.push(span);
+      }
+    }
+  }
+
+  // Every ring of the result, before any identity or welding.
+  const raw: { readonly isHole: boolean; readonly points: [number, number][] }[] = [];
+  for (const polygon of targetPolygon) {
+    for (let rIdx = 0; rIdx < polygon.length; rIdx += 1) {
+      const rawRing = polygon[rIdx]!;
+      const points = rawRing.slice(0, -1).map(([x, z]) => [x, z] as [number, number]);
+      if (points.length >= 3) {
+        let area = 0;
+        for (let i = 0; i < points.length; i++) {
+          const [x1, z1] = points[i]!;
+          const [x2, z2] = points[(i + 1) % points.length]!;
+          area += x1 * z2 - x2 * z1;
+        }
+        if (Math.abs(area * 0.5) >= 0.05) {
+          raw.push({ isHole: rIdx > 0, points });
+        }
+      }
+    }
+  }
+
+  // Every match anyone could make, then the closest ones first, each node and
+  // each corner taken at most once.
+  const proposals: { ring: number; point: number; source: number; distance: number }[] = [];
+  for (let ring = 0; ring < raw.length; ring += 1) {
+    const points = raw[ring]!.points;
+    for (let point = 0; point < points.length; point += 1) {
+      const [x, z] = points[point]!;
+      const reach = pinned({ x, z }) ? 1e-3 : snapDist;
+      const column = Math.floor(x / cell);
+      const row = Math.floor(z / cell);
+      for (let dx = -1; dx <= 1; dx += 1) {
+        for (let dz = -1; dz <= 1; dz += 1) {
+          for (const source of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
+            const at = candidateAt.get(source)!;
+            const distance = Math.hypot(x - at.x, z - at.z);
+            if (distance < reach) proposals.push({ ring, point, source, distance });
+          }
+        }
+      }
+    }
+  }
+  proposals.sort((a, b) => a.distance - b.distance);
+
+  const takenSourceInRing = new Set<string>();
+  const takenPoint = new Set<string>();
+  const matched = new Map<string, number>();
+  for (const proposal of proposals) {
+    const at = `${proposal.ring}:${proposal.point}`;
+    const ringSource = `${proposal.ring}:${proposal.source}`;
+    if (takenSourceInRing.has(ringSource) || takenPoint.has(at)) continue;
+    takenSourceInRing.add(ringSource);
+    takenPoint.add(at);
+    matched.set(at, proposal.source);
+  }
+
+  const rings: (ConstraintRing & { readonly isHole: boolean })[] = [];
+  for (let ring = 0; ring < raw.length; ring += 1) {
+    const { isHole, points: rawPoints } = raw[ring]!;
+
+    // Welded last, and never over a corner that names a node: the whole reason
+    // to shorten a ring is that its segments are far below the face size, and
+    // a corner the ground has to meet exactly is not that.
+    const minStep = Math.max(0.18, faceSize * 0.1);
+    const points: ConstructionGridConstraintPoint[] = [];
+    for (let index = 0; index < rawPoints.length; index += 1) {
+      const source = matched.get(`${ring}:${index}`);
+      const at = source !== undefined ? candidateAt.get(source)! : { x: rawPoints[index]![0], z: rawPoints[index]![1] };
+      const previous = points[points.length - 1];
+      if (previous !== undefined) {
+        const dist = Math.hypot(at.x - previous.x, at.z - previous.z);
+        if (dist < minStep) {
+          if (source !== undefined && previous.source === undefined) {
+            points[points.length - 1] = { x: at.x, z: at.z, source };
+            continue;
+          }
+          if (source === undefined) continue;
+          if (source !== undefined && previous.source !== undefined && dist < 0.05 && !edgeBetween.has(pairKey(previous.source, source))) {
+            continue;
+          }
+        }
+      }
+      points.push(source !== undefined ? { x: at.x, z: at.z, source } : { x: at.x, z: at.z });
+    }
+    while (points.length >= 3) {
+      const last = points[points.length - 1]!;
+      const first = points[0]!;
+      if (last.source !== undefined) break;
+      if (Math.hypot(last.x - first.x, last.z - first.z) >= minStep) break;
+      points.pop();
+    }
+    if (points.length < 3) continue;
+
+    const onEdgeTolerance = Math.max(1e-6, faceSize * 0.01);
+    const restored = restoreSkippedNodes(points, candidateAt, buckets, cell, onEdgeTolerance);
+
+    // Drop collinear unnamed points that add no shape
+    let collinearCleaned = restored;
+    if (restored.length > 3) {
+      const cleaned: ConstructionGridConstraintPoint[] = [];
+      for (let i = 0; i < restored.length; i++) {
+        const prev = restored[(i - 1 + restored.length) % restored.length]!;
+        const curr = restored[i]!;
+        const next = restored[(i + 1) % restored.length]!;
+        if (curr.source === undefined) {
+          const dx = next.x - prev.x;
+          const dz = next.z - prev.z;
+          const len = Math.hypot(dx, dz);
+          if (len > 1e-6) {
+            const off = Math.abs((curr.x - prev.x) * dz - (curr.z - prev.z) * dx) / len;
+            const along = ((curr.x - prev.x) * dx + (curr.z - prev.z) * dz) / (len * len);
+            if (off < 0.08 && along > 0 && along < 1) {
+              continue;
+            }
+          }
+        }
+        cleaned.push(curr);
+      }
+      if (cleaned.length >= 3) collinearCleaned = cleaned;
+    }
+
+
+    // Two nodes answer for a run between them when an edge joins them, and
+    // equally when one edge simply *contains* them both -- a node partway
+    // along another edge is still a place that edge can be split. Without the
+    // second case the run stayed, and a segment with an unnamed point at each
+    // end had nothing to look itself up by: the tooth this dropped to one.
+    const joinedOrSpanned = (a: number, b: number): boolean => {
+      if (edgeBetween.has(pairKey(a, b))) return true;
+      const from = positionOfSource.get(a);
+      const to = positionOfSource.get(b);
+      return from !== undefined && to !== undefined &&
+        edgeAlongSegment(spansAtNode, from, to, onEdgeTolerance) !== undefined;
+    };
+    const stitched = dropInventedCorners(collinearCleaned, joinedOrSpanned, onEdgeTolerance);
+
+
+    const edges: (ConstructionRegionEdge | undefined)[] = [];
+    for (let i = 0; i < stitched.length; i++) {
+      const cur = stitched[i]!;
+      const next = stitched[(i + 1) % stitched.length]!;
+      const paired = cur.source !== undefined && next.source !== undefined
+        ? edgeBetween.get(pairKey(cur.source, next.source))
+        : undefined;
+      edges.push(paired ?? edgeAlongSegment(spansAtNode, cur, next, onEdgeTolerance));
+    }
+    rings.push({ points: stitched, edges, isHole });
+  }
+  return rings;
+}
```

### `apps/vtt/src/composition/tabletop/terrain/terrain-lattice-reaction.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/terrain/terrain-lattice-reaction.ts b/apps/vtt/src/composition/tabletop/terrain/terrain-lattice-reaction.ts
index f4902f3e..6a24dfd4 100644
--- a/apps/vtt/src/composition/tabletop/terrain/terrain-lattice-reaction.ts
+++ b/apps/vtt/src/composition/tabletop/terrain/terrain-lattice-reaction.ts
@@ -9,18 +9,34 @@ import type {
   ConstructionRegionTopology,
   ConstructionTopologyBoundsQuery,
 } from "@/ports";
-import type { CutFallout, Effect, Reaction, ReactionOutcome } from "@/features/edit-construction";
+import type { AtomicEditOp, CutFallout, Effect, Reaction, ReactionOutcome } from "@/features/edit-construction";
 
 import {
+  type ContactCell,
+  type GroundContact,
+  GROUND_CONTACT_CELL,
+  GROUND_CONTACT_CLEARANCE,
+  GROUND_SIDE_REST_ROOM,
+  GROUND_THROUGH_TOLERANCE,
+  groundContactOf,
+  groundSurfaceOf,
+  hasTrait,
+  insideFace,
+  nearestOnSegment,
   planTerrainCloudCutRepair,
+  planarDifference,
+  planarUnion,
   pointInOrOnPolygon,
+  sharedEdgeId,
+  simplifyCollinearVertices,
+  surfaceHeightOf,
   terrainTopologiesBounds,
 } from "../../../features/edit-construction/index.ts";
 import { timePhase } from "../commit-timing.ts";
 import { paintedFalloutOf } from "../interference/painted-topologies.ts";
 import { repairTerrainCut, type TerrainRegenerateRuntime } from "./terrain-regenerate.ts";
 import { REALLY_MOVED, changeAreaOf, largestOuterRing } from "../effects/change-area.ts";
-import type { PlanarArea } from "@/features/edit-construction";
+import type { PlanarArea, PlanarPolygon } from "@/features/edit-construction";
 
 /**
  * The `"lattice-regenerate"` reaction: how a ground cloud answers a change
@@ -64,7 +80,7 @@ function segmentsIntersect(a: readonly [number, number], b: readonly [number, nu
     ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0));
 }
 
-function topologyIntersectsPolygon(topology: ConstructionRegionTopology, polygon: readonly (readonly [number, number])[]): boolean {
+export function topologyIntersectsPolygon(topology: ConstructionRegionTopology, polygon: readonly (readonly [number, number])[]): boolean {
   if (polygon.length < 3 || topology.nodes.length === 0) return false;
   const positions = new Map(topology.nodes.map((node) => [node.id, [node.position.x, node.position.z] as [number, number]]));
   const rings = [...topology.outerLoops, ...topology.holes];
@@ -139,15 +155,40 @@ export function pointBucketIndex(points: readonly ConstructionPosition[], cellSi
   };
 }
 
-function centroidInside(topology: ConstructionRegionTopology, cutters: readonly { outer: [number, number][]; holes: [number, number][][] }[]): boolean {
+function centroidInside(
+  topology: ConstructionRegionTopology,
+  cutters: readonly {
+    readonly outer: readonly (readonly [number, number])[];
+    readonly holes: readonly (readonly (readonly [number, number])[])[];
+  }[],
+): boolean {
   if (topology.nodes.length === 0) return false;
   const cx = topology.nodes.reduce((sum, n) => sum + n.position.x, 0) / topology.nodes.length;
   const cz = topology.nodes.reduce((sum, n) => sum + n.position.z, 0) / topology.nodes.length;
   return cutters.some((poly) => pointInOrOnPolygon(cx, cz, poly.outer) && !poly.holes.some((h) => pointInOrOnPolygon(cx, cz, h)));
 }
 
+function polygonPlanArea(ring: readonly (readonly [number, number])[]): number {
+  let twice = 0;
+  for (let i = 0; i < ring.length; i++) {
+    const a = ring[i]!;
+    const b = ring[(i + 1) % ring.length]!;
+    twice += a[0] * b[1] - b[0] * a[1];
+  }
+  return Math.abs(twice) / 2;
+}
+
+function filterAreaSlivers(area: PlanarArea, minArea = 0.05): PlanarArea {
+  return area.filter((poly) => poly[0] && polygonPlanArea(poly[0]) >= minArea);
+}
+
 /** The changed cloud's faces as solid XZ polygons, read at their live node positions. */
-function cutterPolygonsOf(runtime: LatticeReactionRuntime, faces: readonly ConstructionRegionTopology[]) {
+/** The changed cloud's faces as solid XZ polygons, read at their live node positions, restricted to where they touch ground. */
+function cutterPolygonsOf(
+  runtime: LatticeReactionRuntime,
+  faces: readonly ConstructionRegionTopology[],
+  groundAt?: (p: { readonly x: number; readonly z: number }) => number | undefined,
+) {
   const liveNodes = runtime.getSnapshot().map.nodePositions;
   const ringOf = (face: ConstructionRegionTopology, loop: readonly ConstructionRegionEdge[]): [number, number][] => {
     const ring: [number, number][] = [];
@@ -163,20 +204,299 @@ function cutterPolygonsOf(runtime: LatticeReactionRuntime, faces: readonly Const
     const outer = ringOf(face, face.outerLoops[0]!);
     if (outer.length < 4) return [];
     const holes = face.holes.map((loop) => ringOf(face, loop)).filter((ring) => ring.length >= 4);
+
+    if (groundAt) {
+      const contact = groundContactOf(face, groundAt, GROUND_CONTACT_CELL);
+      if (contact.kind === "none") return [];
+      if (contact.kind === "part" && contact.clear.length > 0) {
+        try {
+          const clearPolygons: PlanarArea = contact.clear.map((ring) => [ring.map(([x, z]) => [x, z] as [number, number])]);
+          const unionClear = planarUnion(runtime, clearPolygons[0]!, ...clearPolygons.slice(1));
+          const facePoly: PlanarPolygon = [outer, ...holes];
+          const cutArea = filterAreaSlivers(planarDifference(runtime, [facePoly], unionClear));
+          return cutArea.map((poly) => ({ outer: poly[0]!, holes: poly.slice(1) }));
+        } catch {
+          return [{ outer, holes }];
+        }
+      }
+    }
     return [{ outer, holes }];
   });
 }
 
+/**
+ * What a structure the ground was joined to no longer holds of it: where it
+ * stood, when it now touches the ground less than wholly -- lifted off it,
+ * tilted out of it. That ground heals, and is cut again only where the
+ * structure still touches it; a move across the plan alone is already the
+ * change's vacated area.
+ */
+function letGoOf(runtime: LatticeReactionRuntime, change: Effect["change"], hits: readonly ConstructionRegionTopology[]): PlanarArea {
+  const own = new Set([...change.before, ...change.after].flatMap((topology) => topology.nodes.map((node) => node.id)));
+  const groundAt = groundSurfaceOf(hits, own);
+  const held = new Set(hits.flatMap((topology) => topology.nodes.map((node) => node.id)));
+  const after = new Map(change.after.map((face) => [face.surfaceKey.join("\u0000"), face]));
+  return change.before.flatMap((face): PlanarArea => {
+    if (!face.nodes.some((node) => held.has(node.id))) return [];
+    const now = after.get(face.surfaceKey.join("\u0000"));
+    if (now && groundContactOf(now, groundAt, GROUND_CONTACT_CELL).kind === "whole") return [];
+    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
+    const ring = (face.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined).map((p) => [p.x, p.z] as [number, number]);
+    if (ring.length < 3) return [];
+    const facePoly: PlanarPolygon = [[...ring, ring[0]!]];
+    const beforeContact = groundContactOf(face, groundAt, GROUND_CONTACT_CELL);
+    if (beforeContact.kind === "none") return [];
+    if (beforeContact.kind === "part" && beforeContact.clear.length > 0) {
+      try {
+        const clearPolygons: PlanarArea = beforeContact.clear.map((r) => [r.map(([x, z]) => [x, z] as [number, number])]);
+        const unionClear = planarUnion(runtime, clearPolygons[0]!, ...clearPolygons.slice(1));
+        return filterAreaSlivers(planarDifference(runtime, [facePoly], unionClear));
+      } catch {
+        return [facePoly];
+      }
+    }
+    return [facePoly];
+  });
+}
+
+/**
+ * How a departing face met the ground it is leaving.
+ *
+ * For a structure already on the tabletop, ground it cut has been removed
+ * (no ground face exists in `hits` inside the cut), while ground it stood
+ * clear of remains intact underneath it. Thus:
+ * - Where an intact ground face exists in `hits` under the structure, its
+ *   height is read; if the structure stood clear above it, it stands clear.
+ * - Where no ground face exists in `hits` (inside the terrain's extent), the
+ *   ground was cut away by this structure -- so it counts as in-cut, not clear.
+ * - Where no ground exists at all (outside the terrain's extent), it stands clear.
+ */
+function departingGroundContactOf(
+  topology: ConstructionRegionTopology,
+  hits: readonly ConstructionRegionTopology[],
+  cell: number,
+  clearance = GROUND_CONTACT_CLEARANCE,
+  tolerance = GROUND_SIDE_REST_ROOM,
+): GroundContact {
+  const surfaceAt = surfaceHeightOf(topology);
+  if (!surfaceAt) return { kind: "whole" };
+  const points = topology.nodes.map((node) => node.position);
+  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
+  const max = { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) };
+  const nx = Math.max(1, Math.ceil((max.x - min.x) / cell));
+  const nz = Math.max(1, Math.ceil((max.z - min.z) / cell));
+  const corner = (i: number, j: number) => ({
+    x: min.x + ((max.x - min.x) * i) / nx,
+    z: min.z + ((max.z - min.z) * j) / nz,
+  });
+
+  const hitXs = hits.flatMap((h) => h.nodes.map((n) => n.position.x));
+  const hitZs = hits.flatMap((h) => h.nodes.map((n) => n.position.z));
+  const bounds = hitXs.length > 0 ? {
+    minX: Math.min(...hitXs),
+    maxX: Math.max(...hitXs),
+    minZ: Math.min(...hitZs),
+    maxZ: Math.max(...hitZs),
+  } : undefined;
+
+  const size = 4;
+  const buckets = new Map<string, ConstructionRegionTopology[]>();
+  for (const face of hits) {
+    const xs = face.nodes.map((n) => n.position.x);
+    const zs = face.nodes.map((n) => n.position.z);
+    const fMinX = Math.min(...xs), fMaxX = Math.max(...xs);
+    const fMinZ = Math.min(...zs), fMaxZ = Math.max(...zs);
+    for (let x = Math.floor(fMinX / size); x <= Math.floor(fMaxX / size); x++) {
+      for (let z = Math.floor(fMinZ / size); z <= Math.floor(fMaxZ / size); z++) {
+        const key = `${x}:${z}`;
+        buckets.set(key, [...(buckets.get(key) ?? []), face]);
+      }
+    }
+  }
+
+  const findFace = (p: { readonly x: number; readonly z: number }) => {
+    const list = buckets.get(`${Math.floor(p.x / size)}:${Math.floor(p.z / size)}`);
+    if (!list) return undefined;
+    for (const t of list) {
+      if (insideFace(t, p)) return t;
+    }
+    return undefined;
+  };
+
+  const held = new Set(hits.flatMap((t) => t.nodes.map((n) => n.id)));
+  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
+  const heldSides = topology.outerLoops.flat().filter((use) => held.has(use.startNodeId) && held.has(use.endNodeId)).map((use) => [at.get(use.startNodeId)!, at.get(use.endNodeId)!] as const);
+  const alongHeld = (p: { readonly x: number; readonly z: number }) => heldSides.some(([a, b]) => nearestOnSegment(p, a, b).distance < cell);
+
+  const sampled = (reach: number) => {
+    const over = (p: { readonly x: number; readonly z: number }) => {
+      if (alongHeld(p)) return -1;
+      const face = findFace(p);
+      if (!face) {
+        if (bounds && (p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ)) {
+          return 1;
+        }
+        return -1;
+      }
+      const gh = surfaceHeightOf(face)?.(p);
+      if (gh === undefined) return -1;
+      return surfaceAt(p) - gh - reach;
+    };
+    const values: number[][] = [];
+    let touched = points.some((p) => over(p) <= 0);
+    let clearAnywhere = points.some((p) => over(p) > 0);
+    for (let i = 0; i <= nx; i++) {
+      values.push([]);
+      for (let j = 0; j <= nz; j++) {
+        const p = corner(i, j), v = over(p);
+        values[i]!.push(v);
+        if (!insideFace(topology, p)) continue;
+        if (v <= 0) touched = true;
+        else clearAnywhere = true;
+      }
+    }
+    return { values, touched, clearAnywhere };
+  };
+
+  const resting = sampled(clearance);
+  if (!resting.touched) return { kind: "none" };
+  if (!resting.clearAnywhere) return { kind: "whole" };
+
+  const through = sampled(tolerance);
+  if (!through.touched) return { kind: "none" };
+  const values = through.values;
+  const clear: ContactCell[] = [];
+  for (let i = 0; i < nx; i++) {
+    for (let j = 0; j < nz; j++) {
+      const ring = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
+      const v = ring.map(([a, b]) => values[a]![b]!);
+      if (v.every((value) => value <= 0)) continue;
+      if (v.every((value) => value > 0)) {
+        const p0 = corner(i, j), p1 = corner(i + 1, j + 1);
+        clear.push([[p0.x, p0.z], [p1.x, p0.z], [p1.x, p1.z], [p0.x, p1.z], [p0.x, p0.z]]);
+        continue;
+      }
+      const piece: [number, number][] = [];
+      for (let k = 0; k < 4; k++) {
+        const [ai, aj] = ring[k]!, [bi, bj] = ring[(k + 1) % 4]!;
+        const va = v[k]!, vb = v[(k + 1) % 4]!;
+        const a = corner(ai, aj), b = corner(bi, bj);
+        if (va > 0) piece.push([a.x, a.z]);
+        if ((va > 0) !== (vb > 0)) {
+          const t = va / (va - vb);
+          piece.push([a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t]);
+        }
+      }
+      if (piece.length >= 3) clear.push([...piece, piece[0]!]);
+    }
+  }
+  if (clear.length === 0) return { kind: "whole" };
+  return { kind: "part", clear };
+}
+
+/**
+ * Where a structure left ground it had cut: the plan it vacated, but only of
+ * the faces that met the ground where they stood -- joined to it by a node,
+ * or resting on it. A face that stood clear of the ground left nothing cut
+ * behind; laying the ground again there would only draw its outline into
+ * ground nobody touched.
+ */
+function vacatedGroundOf(
+  runtime: LatticeReactionRuntime,
+  change: Effect["change"],
+  hits: readonly ConstructionRegionTopology[],
+  vacated: PlanarArea,
+): PlanarArea {
+  const held = new Set(hits.flatMap((topology) => topology.nodes.map((node) => node.id)));
+  const met = change.before.filter((face) => face.nodes.some((node) => held.has(node.id)) || departingGroundContactOf(face, hits, GROUND_CONTACT_CELL).kind !== "none");
+  if (met.length === 0) return [];
+  const baseVacated =
+    met.length === change.before.length
+      ? vacated
+      : (changeAreaOf(runtime, { before: met, after: change.after })?.vacated ?? vacated);
+
+  const clearCells: ContactCell[] = [];
+  for (const face of met) {
+    const contact = departingGroundContactOf(face, hits, GROUND_CONTACT_CELL);
+    if (contact.kind === "part") {
+      clearCells.push(...contact.clear);
+    }
+  }
+  if (clearCells.length > 0) {
+    try {
+      const clearPolygons: PlanarArea = clearCells.map((ring) => [ring.map(([x, z]) => [x, z] as [number, number])]);
+      const unionClear = planarUnion(runtime, clearPolygons[0]!, ...clearPolygons.slice(1));
+      return filterAreaSlivers(planarDifference(runtime, baseVacated, unionClear));
+    } catch {
+      return baseVacated;
+    }
+  }
+  return baseVacated;
+}
+
+/**
+ * Where a structure newly claimed ground it cuts: the plan it claimed, but only
+ * of the faces that actually touch the ground. Suspended portions standing clear
+ * of the ground are subtracted so the ground below remains whole.
+ */
+function claimedGroundOf(
+  runtime: LatticeReactionRuntime,
+  change: Effect["change"],
+  groundAt: (p: { readonly x: number; readonly z: number }) => number | undefined,
+  claimed: PlanarArea,
+): PlanarArea {
+  if (claimed.length === 0) return [];
+  const met = change.after.filter((face) => groundContactOf(face, groundAt, GROUND_CONTACT_CELL).kind !== "none");
+  if (met.length === 0) return [];
+  const baseClaimed =
+    met.length === change.after.length
+      ? claimed
+      : (changeAreaOf(runtime, { before: change.before, after: met })?.claimed ?? claimed);
+
+  const clearCells: ContactCell[] = [];
+  for (const face of met) {
+    const contact = groundContactOf(face, groundAt, GROUND_CONTACT_CELL);
+    if (contact.kind === "part") {
+      clearCells.push(...contact.clear);
+    }
+  }
+  if (clearCells.length > 0) {
+    try {
+      const clearPolygons: PlanarArea = clearCells.map((ring) => [ring.map(([x, z]) => [x, z] as [number, number])]);
+      const unionClear = planarUnion(runtime, clearPolygons[0]!, ...clearPolygons.slice(1));
+      return filterAreaSlivers(planarDifference(runtime, baseClaimed, unionClear));
+    } catch {
+      return baseClaimed;
+    }
+  }
+  return baseClaimed;
+}
+
 function answerCut(runtime: LatticeReactionRuntime, effect: Effect, hits: readonly ConstructionRegionTopology[], executor: LatticeRepairExecutor): void {
   const { change } = effect;
+  const tableId = runtime.getSnapshot().tableId;
+
+  // Simplify any extra collinear degree-2 vertices on floor/platform perimeters
+  if (typeof runtime.applyRegionEdit === "function" && typeof runtime.getRegionTopology === "function") {
+    for (const face of change.after) {
+      if (hasTrait(face.surfaceType, "floor")) {
+        simplifyCollinearVertices(runtime, face, tableId, effect.causeId);
+      }
+    }
+  }
+  const afterFaces = typeof runtime.getRegionTopology === "function"
+    ? change.after.map((f) => runtime.getRegionTopology(f.surfaceKey) ?? f)
+    : change.after;
+  const activeChange = { ...change, after: afterFaces };
+
   const groundTypes = [...new Set(hits.map((hit) => hit.surfaceType))];
   const groundTypeSet = new Set(groundTypes);
 
   const changedPositions: ConstructionPosition[] = [
-    ...change.after.flatMap((t) => t.nodes.map((n) => n.position)),
-    ...change.before.flatMap((t) => t.nodes.map((n) => n.position)),
-    ...change.declaredPositions,
-    ...(change.footprintOutline ?? []).map(([x, z]) => ({ x, y: 0, z })),
+    ...afterFaces.flatMap((t) => t.nodes.map((n) => n.position)),
+    ...activeChange.before.flatMap((t) => t.nodes.map((n) => n.position)),
+    ...activeChange.declaredPositions,
+    ...(activeChange.footprintOutline ?? []).map(([x, z]) => ({ x, y: 0, z })),
   ];
   if (changedPositions.length === 0) return;
 
@@ -187,14 +507,20 @@ function answerCut(runtime: LatticeReactionRuntime, effect: Effect, hits: readon
   // nothing, so there the type's own footprint is exactly the new ground.
   // Without a boolean to answer, it falls back to the type's footprint and the
   // change's whole extent: wider, never narrower than what is needed.
-  const area = change.before.length > 0 ? timePhase("área mudada", () => changeAreaOf(runtime, change)) : undefined;
+  const own = new Set([...activeChange.before, ...afterFaces].flatMap((topology) => topology.nodes.map((node) => node.id)));
+  const groundAt = groundSurfaceOf(hits, own);
+
+  const area = activeChange.before.length > 0 ? timePhase("área mudada", () => changeAreaOf(runtime, activeChange)) : undefined;
   const isEdit = area !== undefined;
-  const claimed: PlanarArea = area?.claimed ?? [];
-  const changed: PlanarArea = area?.vacated ?? [];
+  const rawClaimed: PlanarArea = area?.claimed ?? [];
+  const claimed: PlanarArea = isEdit ? claimedGroundOf(runtime, activeChange, groundAt, rawClaimed) : [];
+  const vacOf = isEdit ? vacatedGroundOf(runtime, activeChange, hits, area.vacated) : [];
+  const letGo = isEdit ? letGoOf(runtime, activeChange, hits) : [];
+  const changed: PlanarArea = [...vacOf, ...letGo];
   const editArea: PlanarArea = [...claimed, ...changed];
 
-  const typeFootprint = change.footprintOutline !== undefined && change.footprintOutline.length >= 3 ? change.footprintOutline : undefined;
-  const footprint = isEdit ? (largestOuterRing(claimed) ?? largestOuterRing(changed)) : typeFootprint;
+  const typeFootprint = activeChange.footprintOutline !== undefined && activeChange.footprintOutline.length >= 3 ? activeChange.footprintOutline : undefined;
+  const footprint = isEdit ? largestOuterRing(claimed) : typeFootprint;
   const extentOf = (points: readonly (readonly [number, number])[]) => {
     const margin = 2.5;
     return {
@@ -218,34 +544,45 @@ function answerCut(runtime: LatticeReactionRuntime, effect: Effect, hits: readon
     : hits.filter((t) => hasNodeIn(t, extentOf(footprint ?? changedPositions.map((p) => [p.x, p.z] as const))) &&
         (footprint === undefined || topologyIntersectsPolygon(t, footprint)));
 
-  const cutters = cutterPolygonsOf(runtime, change.after);
+  const cutters = cutterPolygonsOf(runtime, afterFaces, groundAt);
 
-  const afterNodeIds = new Set(change.after.flatMap((t) => t.nodes.map((n) => n.id)));
-  const destroyedNodeIds = new Set<ConstructionNodeId>(change.removedNodeIds);
-  for (const t of change.before) for (const n of t.nodes) if (!afterNodeIds.has(n.id)) destroyedNodeIds.add(n.id);
+  const afterNodeIds = new Set(afterFaces.flatMap((t) => t.nodes.map((n) => n.id)));
+  const destroyedNodeIds = new Set<ConstructionNodeId>(activeChange.removedNodeIds);
+  for (const t of activeChange.before) for (const n of t.nodes) if (!afterNodeIds.has(n.id)) destroyedNodeIds.add(n.id);
 
   // A destroyed node no new node stands near was genuinely moved or abandoned.
   // A node whose position did not move was merely re-minted, which is no
   // reason to regenerate ground.
-  const afterSpatial = pointBucketIndex(change.after.flatMap((t) => t.nodes.map((n) => n.position)), REALLY_MOVED);
+  const afterSpatial = pointBucketIndex(afterFaces.flatMap((t) => t.nodes.map((n) => n.position)), REALLY_MOVED);
   const abandonedNodeIds = new Set<ConstructionNodeId>();
-  for (const t of change.before) {
+  for (const t of activeChange.before) {
     for (const n of t.nodes) {
       if (destroyedNodeIds.has(n.id) && !afterSpatial.isNear(n.position.x, n.position.z)) abandonedNodeIds.add(n.id);
     }
   }
 
+  // **Ground an edit stretched.** An edit keeps its node ids and moves them;
+  // ground rimmed by those same nodes was carried along, stretched from where
+  // the shape stood to where it went. However far that is, it is rebuilt.
+  const beforePositions = new Map(activeChange.before.flatMap((t) => t.nodes.map((n) => [n.id, n.position] as const)));
+  const carriedNodeIds = new Set(afterFaces.flatMap((t) => t.nodes.filter((n) => {
+    const was = beforePositions.get(n.id);
+    // Lifted as much as moved across: ground rimmed by a node raised off it is stretched all the same.
+    return was !== undefined && Math.hypot(was.x - n.position.x, was.y - n.position.y, was.z - n.position.z) > REALLY_MOVED;
+  }).map((n) => n.id)));
+
   // **Ground about to be orphaned, wherever it stands.** A change regenerating
   // its whole connected component re-mints every node in it, including the
   // corners ground split into its own edges to share them. Every one of those
   // stops existing, and the ground holding them is mostly nowhere near the
   // footprint -- so the search reaches the whole replaced extent, not the stroke.
   const orphaned: ConstructionRegionTopology[] = [];
-  if (change.before.length > 0) {
-    const beforeBounds = terrainTopologiesBounds(change.before, 4.0);
+  if (activeChange.before.length > 0) {
+    const beforeBounds = terrainTopologiesBounds(activeChange.before, 4.0);
     for (const t of hits) {
-      if (!hasNodeIn(t, beforeBounds)) continue;
-      const sharesAbandoned = abandonedNodeIds.size > 0 && t.nodes.some((n) => abandonedNodeIds.has(n.id));
+      if (!hasNodeIn(t, beforeBounds) && !t.nodes.some((n) => carriedNodeIds.has(n.id))) continue;
+      const sharesAbandoned = (abandonedNodeIds.size > 0 && t.nodes.some((n) => abandonedNodeIds.has(n.id)))
+        || (carriedNodeIds.size > 0 && t.nodes.some((n) => carriedNodeIds.has(n.id)));
       const insideChanged = changed.length > 0 && t.nodes.length > 0 && (
         t.nodes.some((n) => insideAny(n.position.x, n.position.z, changed)) ||
         insideAny(
@@ -280,16 +617,43 @@ function answerCut(runtime: LatticeReactionRuntime, effect: Effect, hits: readon
     footprintOutline: footprint,
     cutterPolygons: cutters,
   }));
-  if (!plan.requiresRepair && changed.length === 0) return;
+  // Ground the edit dragged along is stale however the planner reads it: it goes.
+  const stretched = orphaned.filter((t) => t.nodes.some((n) => carriedNodeIds.has(n.id)));
+  if (!plan.requiresRepair && changed.length === 0 && stretched.length === 0) {
+    if (typeof runtime.applyRegionEdit === "function" && typeof runtime.getRegionTopology === "function") {
+      for (const face of change.after) {
+        if (hasTrait(face.surfaceType, "floor")) {
+          const live = runtime.getRegionTopology(face.surfaceKey) ?? face;
+          simplifyCollinearVertices(runtime, live, tableId, effect.causeId);
+        }
+      }
+    }
+    return;
+  }
 
-  const painter = change.after.length > 0
-    ? timePhase("perímetro da mudança", () => paintedFalloutOf(change.after))
+  const painter = afterFaces.length > 0
+    ? timePhase("perímetro da mudança", () => paintedFalloutOf(afterFaces))
     : { paintedNodes: [], paintedLoops: [] };
 
   const consumedByType = new Map(plan.consumedByType);
+  for (const t of stretched) {
+    const keys = consumedByType.get(t.surfaceType) ?? [];
+    if (!keys.some((key) => key.join(" ") === t.surfaceKey.join(" "))) consumedByType.set(t.surfaceType, [...keys, t.surfaceKey]);
+  }
   if (consumedByType.size === 0 && changed.length > 0) consumedByType.set(groundTypes[0]!, []);
 
-  const tableId = runtime.getSnapshot().tableId;
+  // **Where the dragged ground lay, not where it was dragged to.** A face
+  // rimmed by a node the edit carried is consumed as it now stands --
+  // stretched out to where the node went -- so its own shape no longer covers
+  // the ground it covered. That ground is laid again as vacated, or the
+  // structure leaves a hole wherever it moves away from.
+  const draggedFrom: PlanarArea = stretched.flatMap((topology): PlanarArea => {
+    const at = new Map(topology.nodes.map((node) => [node.id, carriedNodeIds.has(node.id) ? beforePositions.get(node.id) ?? node.position : node.position]));
+    const ring = (topology.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined).map((p) => [p.x, p.z] as [number, number]);
+    return ring.length >= 3 ? [[[...ring, ring[0]!]]] : [];
+  });
+  const vacatedGround: PlanarArea = [...changed, ...draggedFrom];
+
   for (const [surfaceType, consumedSurfaceKeys] of consumedByType) {
     timePhase(`regeneração de ${surfaceType}`, () => executor(
       runtime,
@@ -302,12 +666,22 @@ function answerCut(runtime: LatticeReactionRuntime, effect: Effect, hits: readon
         // instead of laying ground over it.
         footprintOutline: footprint,
         painterSurfaceType: change.surfaceType,
-        vacatedGround: changed,
+        vacatedGround,
+        draggedSurfaceKeys: stretched.filter((topology) => topology.surfaceType === surfaceType).map((topology) => topology.surfaceKey),
       },
       effect.causeId,
       tableId,
     ));
   }
+
+  if (typeof runtime.applyRegionEdit === "function" && typeof runtime.getRegionTopology === "function") {
+    for (const face of change.after) {
+      if (hasTrait(face.surfaceType, "floor")) {
+        const live = runtime.getRegionTopology(face.surfaceKey) ?? face;
+        simplifyCollinearVertices(runtime, live, tableId, effect.causeId);
+      }
+    }
+  }
 }
 
 /**
```

### `apps/vtt/src/composition/tabletop/terrain/terrain-regenerate.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/terrain/terrain-regenerate.ts b/apps/vtt/src/composition/tabletop/terrain/terrain-regenerate.ts
index c93cce9e..672a69a5 100644
--- a/apps/vtt/src/composition/tabletop/terrain/terrain-regenerate.ts
+++ b/apps/vtt/src/composition/tabletop/terrain/terrain-regenerate.ts
@@ -8,6 +8,7 @@ import { executeTerrainCut } from "./terrain-cut-executor.ts";
 import { DEFAULT_FACE_SIDE } from "./terrain-fill.ts";
 import type { TerrainCutRuntime } from "./terrain-neighborhood.ts";
 import { hasTrait } from "../../../features/edit-construction/index.ts";
+import { topologyIntersectsPolygon } from "./terrain-lattice-reaction.ts";
 
 /**
  * Growing terrain back where something cut through it.
@@ -136,38 +137,100 @@ export function repairTerrainCut(
     .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
   if (consumed.length === 0 && (!fallout.vacatedGround || fallout.vacatedGround.length === 0)) return 0;
 
+  const connectTo =
+    fallout.painterSurfaceType !== undefined
+      ? { surfaceType: fallout.painterSurfaceType }
+      : undefined;
+
+  const hasVacated = fallout.vacatedGround && fallout.vacatedGround.length > 0;
+  const hasFootprint = fallout.footprintOutline !== undefined && fallout.footprintOutline.length >= 3;
+
+  if (hasVacated && hasFootprint) {
+    let builtTotal = 0;
+    // 1. Where the structure left: regrow vacated ground and clear dragged stale regions.
+    const vacatedOutline = outlineAroundMultiPolygon(fallout.vacatedGround!);
+    if (vacatedOutline.length >= 3) {
+      const draggedKeys = new Set((fallout.draggedSurfaceKeys ?? []).map((k) => k.join(" ")));
+      const vacatedConsumed = consumed.filter((t) => draggedKeys.has(t.surfaceKey.join(" ")) || topologyIntersectsPolygon(t, vacatedOutline));
+      const outcome = executeTerrainCut(runtime, {
+        area: { outline: vacatedOutline },
+        coveredRegions: vacatedConsumed.map((topology) => ({
+          surfaceKey: topology.surfaceKey,
+          surfaceType: topology.surfaceType,
+        })),
+        targetSurfaceType: (consumed[0] && hasTrait(consumed[0].surfaceType, "ground")) ? consumed[0].surfaceType : "terrain",
+        profile: {
+          kind: "regenerate",
+          connectTo,
+        },
+        vacatedArea: fallout.vacatedGround,
+        staleRegions: fallout.draggedSurfaceKeys,
+        causeId: `${causeId}:vacated`,
+        tableId,
+        faceSide: DEFAULT_FACE_SIDE,
+        seed: Math.max(1, Math.abs(hashOf(fallout.draggedSurfaceKeys ?? []))),
+        irregularity: 0.7,
+      });
+      builtTotal += outcome.builtFaces;
+    }
+
+    // 2. Where the structure arrived: re-cut ground around it.
+    const outline = fallout.footprintOutline!;
+    const draggedKeys = new Set((fallout.draggedSurfaceKeys ?? []).map((k) => k.join(" ")));
+    const arrivalConsumed = consumed
+      .filter((t) => !draggedKeys.has(t.surfaceKey.join(" ")))
+      .filter((t) => topologyIntersectsPolygon(t, outline));
+    const outcome = executeTerrainCut(runtime, {
+      area: { outline },
+      coveredRegions: arrivalConsumed.map((topology) => ({
+        surfaceKey: topology.surfaceKey,
+        surfaceType: topology.surfaceType,
+      })),
+      targetSurfaceType: (consumed[0] && hasTrait(consumed[0].surfaceType, "ground")) ? consumed[0].surfaceType : "terrain",
+      profile: {
+        kind: "regenerate",
+        connectTo,
+      },
+      causeId,
+      tableId,
+      faceSide: DEFAULT_FACE_SIDE,
+      seed: Math.max(1, Math.abs(hashOf(fallout.consumedSurfaceKeys))),
+      irregularity: 0.7,
+    });
+    builtTotal += outcome.builtFaces;
+    return builtTotal;
+  }
+
+  // Single cut (creation, pure deletion, or pure vacated without footprint)
   const outline =
-    fallout.footprintOutline !== undefined && fallout.footprintOutline.length >= 3
-      ? fallout.footprintOutline
-      : (consumed.length > 0
-          ? outlineAroundConsumed(consumed)
-          : (fallout.vacatedGround ? outlineAroundMultiPolygon(fallout.vacatedGround) : []));
+    hasFootprint
+      ? fallout.footprintOutline!
+      : (hasVacated
+          ? outlineAroundMultiPolygon(fallout.vacatedGround!)
+          : (consumed.length > 0 ? outlineAroundConsumed(consumed) : []));
   if (outline.length < 3) return 0;
 
+  const draggedKeys = new Set((fallout.draggedSurfaceKeys ?? []).map((k) => k.join(" ")));
+  const covered = (hasVacated && !hasFootprint)
+    ? consumed.filter((t) => draggedKeys.has(t.surfaceKey.join(" ")) || (fallout.vacatedGround && fallout.vacatedGround.some((p) => p[0] && topologyIntersectsPolygon(t, p[0]))))
+    : consumed;
+
   const outcome = executeTerrainCut(runtime, {
     area: { outline },
-    // The planner already resolved which ground this cut consumed. Handing it
-    // over rather than letting the executor re-derive it from the outline
-    // keeps one answer to that question instead of two.
-    coveredRegions: consumed.map((topology) => ({
+    coveredRegions: covered.map((topology) => ({
       surfaceKey: topology.surfaceKey,
       surfaceType: topology.surfaceType,
     })),
     targetSurfaceType: (consumed[0] && hasTrait(consumed[0].surfaceType, "ground")) ? consumed[0].surfaceType : "terrain",
     profile: {
       kind: "regenerate",
-      connectTo:
-        fallout.painterSurfaceType !== undefined
-          ? { surfaceType: fallout.painterSurfaceType }
-          : undefined,
+      connectTo,
     },
     vacatedArea: fallout.vacatedGround,
+    staleRegions: fallout.draggedSurfaceKeys,
     causeId,
     tableId,
     faceSide: DEFAULT_FACE_SIDE,
-    // Deterministic in the ground itself rather than in the clock, so the same
-    // neighbourhood regenerated twice comes back the same: replayable from the
-    // same log.
     seed: Math.max(1, Math.abs(hashOf(fallout.consumedSurfaceKeys))),
     irregularity: 0.7,
   });
```

### `apps/vtt/src/composition/tabletop/terrain/terrain-fill.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/terrain/terrain-fill.ts b/apps/vtt/src/composition/tabletop/terrain/terrain-fill.ts
index c9ed586e..3d72aa47 100644
--- a/apps/vtt/src/composition/tabletop/terrain/terrain-fill.ts
+++ b/apps/vtt/src/composition/tabletop/terrain/terrain-fill.ts
@@ -23,7 +23,7 @@ import {
 } from "./terrain-constraints.ts";
 import { logTerrainCommit } from "./terrain-diagnostics.ts";
 import { countInCommit, timePhase } from "../commit-timing.ts";
-import { createBoundaryEdges, hasTrait, pointInOrOnPolygon, sharedEdgeId } from "../../../features/edit-construction/index.ts";
+import { createBoundaryEdges, hasTrait, pointInOrOnPolygon, sharedEdgeId, structureTypeFor } from "../../../features/edit-construction/index.ts";
 import type { PlanarArea } from "@/features/edit-construction";
 
 
@@ -258,6 +258,83 @@ export interface QuadDrops {
   coveredByStanding: number;
 }
 
+function triangleArea(p0: { x: number; z: number }, p1: { x: number; z: number }, p2: { x: number; z: number }): number {
+  return 0.5 * (p0.x * (p1.z - p2.z) + p1.x * (p2.z - p0.z) + p2.x * (p0.z - p1.z));
+}
+
+/**
+ * Splits a concave (non-convex / chevron) quad into two convex triangles along
+ * its interior diagonal. A quad wrapping around a reflex corner of an obstacle
+ * has its arithmetic centroid lying outside the quad in the notch (inside the
+ * obstacle), causing avoidArea to falsely drop it as covered or groundUnder to
+ * falsely see it as under the obstacle. Splitting it restores convex cells
+ * whose centroids lie strictly inside each triangle.
+ */
+function convexifyCell(grid: ConstructionIrregularQuadGrid, cell: readonly number[]): (readonly number[])[] {
+  if (cell.length !== 4) return [cell];
+  const pts = cell.map((i) => grid.vertices[i]);
+  if (pts.some((p) => p === undefined)) return [cell];
+  const [p0, p1, p2, p3] = pts as [{ x: number; z: number }, { x: number; z: number }, { x: number; z: number }, { x: number; z: number }];
+
+  const e0x = p1.x - p0.x, e0z = p1.z - p0.z;
+  const e1x = p2.x - p1.x, e1z = p2.z - p1.z;
+  const e2x = p3.x - p2.x, e2z = p3.z - p2.z;
+  const e3x = p0.x - p3.x, e3z = p0.z - p3.z;
+
+  const cp0 = e0x * e1z - e0z * e1x;
+  const cp1 = e1x * e2z - e1z * e2x;
+  const cp2 = e2x * e3z - e2z * e3x;
+  const cp3 = e3x * e0z - e3z * e0x;
+
+  const eps = 1e-6;
+  const pos = (cp0 > eps ? 1 : 0) + (cp1 > eps ? 1 : 0) + (cp2 > eps ? 1 : 0) + (cp3 > eps ? 1 : 0);
+  const neg = (cp0 < -eps ? 1 : 0) + (cp1 < -eps ? 1 : 0) + (cp2 < -eps ? 1 : 0) + (cp3 < -eps ? 1 : 0);
+
+  // Strictly convex quad
+  if ((pos === 4 && neg === 0) || (neg === 4 && pos === 0)) return [cell];
+
+  // Try splitting along diagonal 0-2
+  const a02_1 = triangleArea(p0, p1, p2);
+  const a02_2 = triangleArea(p0, p2, p3);
+
+  // Try splitting along diagonal 1-3
+  const a13_1 = triangleArea(p1, p2, p3);
+  const a13_2 = triangleArea(p1, p3, p0);
+
+  const isCCW = (pos >= neg);
+  const sign = isCCW ? 1 : -1;
+
+  const s02_1 = sign * a02_1;
+  const s02_2 = sign * a02_2;
+  const s13_1 = sign * a13_1;
+  const s13_2 = sign * a13_2;
+
+  // Prefer the split where both triangles are strictly positive
+  if (s02_1 > eps && s02_2 > eps) {
+    return [[cell[0]!, cell[1]!, cell[2]!], [cell[0]!, cell[2]!, cell[3]!]];
+  }
+  if (s13_1 > eps && s13_2 > eps) {
+    return [[cell[1]!, cell[2]!, cell[3]!], [cell[1]!, cell[3]!, cell[0]!]];
+  }
+
+  // If one diagonal has a valid non-degenerate triangle while the other triangle is a degenerate/inverted sliver:
+  const sliverThreshold = 0.05;
+  if (s02_1 > eps && s02_2 <= eps && Math.abs(s02_2) < sliverThreshold) {
+    return [[cell[0]!, cell[1]!, cell[2]!]];
+  }
+  if (s02_2 > eps && s02_1 <= eps && Math.abs(s02_1) < sliverThreshold) {
+    return [[cell[0]!, cell[2]!, cell[3]!]];
+  }
+  if (s13_1 > eps && s13_2 <= eps && Math.abs(s13_2) < sliverThreshold) {
+    return [[cell[1]!, cell[2]!, cell[3]!]];
+  }
+  if (s13_2 > eps && s13_1 <= eps && Math.abs(s13_1) < sliverThreshold) {
+    return [[cell[1]!, cell[3]!, cell[0]!]];
+  }
+
+  return [cell];
+}
+
 /** Exported for `terrain-quad-drops.test.mjs`, which holds the rules a cell is dropped by. */
 export function gridPatch(
   tableId: string,
@@ -291,7 +368,10 @@ export function gridPatch(
     }
   }
 
-  quad: for (const quad of grid.quads) {
+  const cells = (avoidArea !== undefined && avoidArea.length > 0)
+    ? grid.quads.flatMap((q) => convexifyCell(grid, q))
+    : grid.quads;
+  quad: for (const quad of cells) {
     if (avoidArea !== undefined && avoidArea.length > 0) {
       let cx = 0;
       let cz = 0;
@@ -361,6 +441,37 @@ export function gridPatch(
   return { nodes: nodes.filter((node) => usedNodes.has(node.id)), edges: patchEdges, regions };
 }
 
+/**
+ * Why `rings` are no ground a generator can fill -- a ring with fewer than
+ * three corners, two corners on top of each other, or a ring crossing itself
+ * -- or `undefined` when they are sound. Separate rings may overlap: the
+ * generator joins them.
+ */
+export function tangledRing(rings: readonly (readonly { readonly x: number; readonly z: number }[])[]): string | undefined {
+  const side = (p: { x: number; z: number }, q: { x: number; z: number }, r: { x: number; z: number }) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
+  const crosses = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }, d: { x: number; z: number }) => {
+    const d1 = side(c, d, a), d2 = side(c, d, b), d3 = side(a, b, c), d4 = side(a, b, d);
+    return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12)) && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
+  };
+  const segments: { ring: number; index: number; a: { x: number; z: number }; b: { x: number; z: number } }[] = [];
+  for (const [ring, points] of rings.entries()) {
+    if (points.length < 3) return `anel ${ring} com ${points.length} ponto(s)`;
+    for (let index = 0; index < points.length; index++) {
+      const a = points[index]!, b = points[(index + 1) % points.length]!;
+      if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-6) return `anel ${ring} com dois cantos no mesmo lugar`;
+      segments.push({ ring, index, a, b });
+    }
+  }
+  for (let i = 0; i < segments.length; i++) {
+    const s = segments[i]!;
+    for (let j = i + 1; j < segments.length; j++) {
+      const t = segments[j]!;
+      if (s.ring === t.ring && crosses(s.a, s.b, t.a, t.b)) return `anel ${s.ring} cruza a si mesmo`;
+    }
+  }
+  return undefined;
+}
+
 /**
  * Generates ground for `boundary` minus `holes`, adopts the nodes it lands on
  * the neighbours' edges, and registers the result.
@@ -371,6 +482,15 @@ export function gridPatch(
  */
 export function fillTerrain(runtime: TerrainFillRuntime, request: TerrainFillRequest): TerrainFillOutcome {
   if (request.boundary.length === 0) return NOTHING;
+  // A ring that crosses itself describes no ground: the
+  // generator would not refuse them but fail inside the engine, and a failure
+  // there leaves the whole session unusable for every edit after it. They are
+  // refused here instead, and the ground there is left as it stands.
+  const tangled = tangledRing([...request.boundary, ...request.holes].map((ring) => ring.points));
+  if (tangled !== undefined) {
+    console.warn(`[terreno] contorno emaranhado recusado antes do gerador: ${tangled}`);
+    return { ...NOTHING, refused: 1 };
+  }
 
   let bMinX = Infinity;
   let bMinZ = Infinity;
@@ -511,6 +631,35 @@ export function fillTerrain(runtime: TerrainFillRuntime, request: TerrainFillReq
     return Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSq));
   };
 
+  // **A ring's own corner with no node, partway along a neighbour's edge** --
+  // where a cut gave way partway along a structure's side -- splits that edge
+  // like any node the grid puts along it. The ground and the structure then
+  // share it, so it goes wherever the structure goes, and the ground there is
+  // laid again when it does; a node of the ground's own only coinciding with
+  // the side would be left standing in the air.
+  const adoptedVertices = new Set(effectiveAdoptions.map((candidate) => candidate.vertex));
+  for (const ring of [...request.boundary, ...request.holes]) {
+    const count = ring.points.length;
+    for (let index = 0; index < count; index += 1) {
+      const point = ring.points[index]!;
+      if (point.source !== undefined) continue;
+      const vertex = grid.vertices.findIndex((candidate) => Math.hypot(candidate.x - point.x, candidate.z - point.z) < 1e-4);
+      if (vertex < 0 || adoptedVertices.has(vertex) || snapped.has(vertex) || grid.vertices[vertex]!.source !== undefined) continue;
+      for (const edge of [ring.edges[index], ring.edges[(index - 1 + count) % count]]) {
+        if (edge === undefined) continue;
+        const from = live.get(edge.startNodeId)?.position, to = live.get(edge.endNodeId)?.position;
+        if (from === undefined || to === undefined) continue;
+        const length = Math.hypot(to.x - from.x, to.z - from.z);
+        const along = alongEdge(point, from, to, -1);
+        const off = Math.hypot(point.x - (from.x + (to.x - from.x) * along), point.z - (from.z + (to.z - from.z) * along));
+        if (length <= 0 || off > 1e-3 || along * length < 1e-3 || (1 - along) * length < 1e-3) continue;
+        effectiveAdoptions.push({ vertex, edge, along, edgeLength: length });
+        adoptedVertices.add(vertex);
+        break;
+      }
+    }
+  }
+
   const adoptionPositions = new Map<number, ConstructionPosition>();
   for (const [index, adoption] of effectiveAdoptions.entries()) {
     const vertex = grid.vertices[adoption.vertex];
@@ -541,11 +690,17 @@ export function fillTerrain(runtime: TerrainFillRuntime, request: TerrainFillReq
     adoptionPositions.set(adoption.vertex, { x: vertex.x, y, z: vertex.z });
   }
 
-  const adoption = timePhase(`adoção de nós (${effectiveAdoptions.length})`, () => adoptContourNodes(
+  // A side of a structure whose outline is sealed is met, never split: the
+  // corner stays where the side runs, at its height, as a node of the ground's own.
+  const sealed = new Set(runtime.getRegionTopologiesInBounds(bounds)
+    .filter((topology) => structureTypeFor(topology.surfaceType)?.sealedOutline === true)
+    .flatMap((topology) => [...topology.outerLoops, ...topology.holes].flat().map((use) => use.edgeId)));
+  const splitting = sealed.size === 0 ? effectiveAdoptions : effectiveAdoptions.filter((candidate) => !sealed.has(candidate.edge.edgeId));
+  const adoption = timePhase(`adoção de nós (${splitting.length})`, () => adoptContourNodes(
     runtime,
     request.tableId,
     request.causeId,
-    effectiveAdoptions,
+    splitting,
     (vertex) => nodeId(request.mint, vertex),
     (vertex) => adoptionPositions.get(vertex),
   ));
@@ -619,7 +774,11 @@ export function fillTerrain(runtime: TerrainFillRuntime, request: TerrainFillReq
     if (uses.length === 1 && occupiedUse !== undefined) {
       edgeRooms.set(edgeId, {
         edgeId,
-        reversed: !occupiedUse.reversed,
+        // The free side walks the standing use backwards. Under its own id that
+        // is simply the opposite flag; under the shared id -- another edge on the
+        // same two nodes, stored lowest id first -- it is read against that
+        // storage, or the face walks it backwards and never closes.
+        reversed: occupiedUse.edgeId === edgeId ? !occupiedUse.reversed : !(occupiedUse.endNodeId < occupiedUse.startNodeId),
         startNodeId: occupiedUse.endNodeId,
         endNodeId: occupiedUse.startNodeId,
       });
```

### `apps/vtt/src/composition/tabletop/terrain/terrain-diagnostics.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/terrain/terrain-diagnostics.ts b/apps/vtt/src/composition/tabletop/terrain/terrain-diagnostics.ts
index 80a2cef8..0382a35d 100644
--- a/apps/vtt/src/composition/tabletop/terrain/terrain-diagnostics.ts
+++ b/apps/vtt/src/composition/tabletop/terrain/terrain-diagnostics.ts
@@ -2,6 +2,7 @@ import type { ConstructionGridConstraintPoint, ConstructionIrregularQuadGrid } f
 
 const TOOL_DIAGNOSTIC_PREFIX = "[grafting:vtt]";
 import type { ConstraintRing } from "./terrain-constraints.ts";
+import { twiceSignedArea } from "../../../features/edit-construction/index.ts";
 
 /**
  * What one terrain commit actually did, on the console.
@@ -61,19 +62,9 @@ function segmentLengths(rings: readonly ConstraintRing[]): number[] {
  * So the orientations are measured here first, against a real drawing, rather
  * than assumed either way again.
  */
-function twiceSignedArea(ring: ConstraintRing): number {
-  let twice = 0;
-  for (let index = 0; index < ring.points.length; index += 1) {
-    const from = ring.points[index]!;
-    const to = ring.points[(index + 1) % ring.points.length]!;
-    twice += from.x * to.z - to.x * from.z;
-  }
-  return twice;
-}
-
-/** `+`/`-` per ring, in order, so a disagreement is visible at a glance. */
 function orientations(rings: readonly ConstraintRing[]): string {
-  return rings.map((ring) => (twiceSignedArea(ring) >= 0 ? "+" : "-")).join("") || "·";
+  // `+`/`-` per ring, in order, so a disagreement is visible at a glance.
+  return rings.map((ring) => (twiceSignedArea(ring.points) >= 0 ? "+" : "-")).join("") || "·";
 }
 
 function pointCount(rings: readonly ConstraintRing[]): number {
@@ -221,17 +212,6 @@ export interface TerrainCommitReport {
   };
 }
 
-/** Plan-view area of a ring of constraint points, unsigned. */
-function ringArea(points: readonly { readonly x: number; readonly z: number }[]): number {
-  let twice = 0;
-  for (let index = 0; index < points.length; index += 1) {
-    const from = points[index]!;
-    const to = points[(index + 1) % points.length]!;
-    twice += from.x * to.z - to.x * from.z;
-  }
-  return Math.abs(twice) / 2;
-}
-
 /**
  * Never throws, whatever it is handed.
  *
@@ -259,8 +239,8 @@ function describe(report: TerrainCommitReport): void {
     aneisBoundary: report.boundary.length,
     aneisHoles: report.holes.length,
     areaPedida: round(
-      report.boundary.reduce((sum, ring) => sum + ringArea(ring.points), 0) -
-        report.holes.reduce((sum, ring) => sum + ringArea(ring.points), 0),
+      report.boundary.reduce((sum, ring) => sum + Math.abs(twiceSignedArea(ring.points)) / 2, 0) -
+        report.holes.reduce((sum, ring) => sum + Math.abs(twiceSignedArea(ring.points)) / 2, 0),
     ),
     areaCoberta: round(report.coveredArea ?? 0),
     celulasEvitadas: report.quadDrops?.avoided ?? 0,
```

### `apps/vtt/src/features/edit-construction/topology/ground-contact.ts`

```diff
diff --git a/apps/vtt/src/features/edit-construction/topology/ground-contact.ts b/apps/vtt/src/features/edit-construction/topology/ground-contact.ts
new file mode 100644
index 00000000..d574cd7a
--- /dev/null
+++ b/apps/vtt/src/features/edit-construction/topology/ground-contact.ts
@@ -0,0 +1,246 @@
+import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";
+
+import { faceRings, insideFace, nearestOnSegment, planeOf } from "./plan-geometry.ts";
+
+/**
+ * Where a structure rests on the ground. A structure that cuts the ground --
+ * a floor, a ramp, a road -- cuts it only where it rests on it: where its
+ * surface stands below the ground, or no more than
+ * {@link GROUND_CONTACT_CLEARANCE} above it. There the ground is cut and
+ * rises or falls to meet its edge -- a foundation. A floor high over the
+ * terrain, a storey, leaves the terrain whole under it; a floor on a
+ * hillside cuts the hill only where it rests on it, and the ground passes
+ * under the rest. Worked out from the geometry every time, so an edit
+ * that lifts a structure off the ground frees it, and one that lowers it cuts
+ * again -- nothing is stored, nothing asks what the structure is.
+ */
+
+/*
+ * Calibration. These values are global for now: every cutting type reads the
+ * same ones. They are to move into the VTT's global calibration menu, and
+ * later to be declared per type and per interaction -- a road and a platform,
+ * a creation and an edit, meeting the ground differently (see `cut` in
+ * `structure-types/creation-interaction.ts`).
+ */
+
+/**
+ * How far above the ground a structure's surface may stand and still rest on
+ * it, the ground rising to meet it. Well short of a storey, well past the
+ * unevenness of ground a floor is drawn on.
+ */
+export const GROUND_CONTACT_CLEARANCE = 1.5;
+/**
+ * How near the ground a surface standing partly clear of it may run and still
+ * count as the ground rising through it -- a floor laid flush on the ground,
+ * whose every sample would otherwise flicker in and out of it.
+ */
+export const GROUND_THROUGH_TOLERANCE = 0.05;
+/** How far past the resting line a ground corner on a structure's side may stand and still meet the side. */
+export const GROUND_SIDE_REST_ROOM = 0.25;
+
+type Plan = { readonly x: number; readonly z: number };
+
+/** The ground's height at a point in plan; `undefined` where there is no ground to speak of. */
+export type GroundHeightAt = (point: Plan) => number | undefined;
+
+/** One square of a contact sampling grid, as a closed ring. */
+export type ContactCell = readonly (readonly [number, number])[];
+
+/** How a face meets the ground: wholly, not at all, or in part -- with the cells of its footprint that stand clear of it. */
+export type GroundContact =
+  | { readonly kind: "whole" }
+  | { readonly kind: "none" }
+  | { readonly kind: "part"; readonly clear: readonly ContactCell[] };
+
+/** The height of `topology`'s surface over a point in plan -- its best plane; `undefined` for a face standing upright. */
+export function surfaceHeightOf(topology: ConstructionRegionTopology): ((point: Plan) => number) | undefined {
+  const plane = planeOf(faceRings(topology)[0] ?? []);
+  if (!plane || Math.abs(plane.normal.y) < 0.05) return undefined;
+  const { normal: n, centre: c } = plane;
+  return (point) => c.y - (n.x * (point.x - c.x) + n.z * (point.z - c.z)) / n.y;
+}
+
+/**
+ * How `topology` meets the ground `groundAt` describes, sampled on a grid of
+ * `cell` over its footprint. Within `clearance` of the ground all over, it
+ * rests wholly. Standing clear somewhere, it is cut only where the ground
+ * runs through it: that line is found between the samples, by marching
+ * squares, so the cut follows it instead of stepping round whole cells.
+ * Where no ground is known it is clear. A face standing upright is left as
+ * it always was -- wholly in contact.
+ *
+ * A side whose two ends `held` names -- joined to another structure, a
+ * ramp's end welded into a floor -- has that structure on its far side and
+ * this one on the near side: no ground fits under it too, so it counts as
+ * touching for a cell round it, and the ground goes round.
+ */
+export function groundContactOf(topology: ConstructionRegionTopology, groundAt: GroundHeightAt, cell: number, clearance = GROUND_CONTACT_CLEARANCE, held: ReadonlySet<string> = new Set()): GroundContact {
+  const surfaceAt = surfaceHeightOf(topology);
+  if (!surfaceAt) return { kind: "whole" };
+  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
+  const heldSides = topology.outerLoops.flat().filter((use) => held.has(use.startNodeId) && held.has(use.endNodeId)).map((use) => [at.get(use.startNodeId)!, at.get(use.endNodeId)!] as const);
+  const alongHeld = (p: Plan) => heldSides.some(([a, b]) => nearestOnSegment(p, a, b).distance < cell);
+  const points = topology.nodes.map((node) => node.position);
+  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
+  const max = { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) };
+  const nx = Math.max(1, Math.ceil((max.x - min.x) / cell)), nz = Math.max(1, Math.ceil((max.z - min.z) / cell));
+  const corner = (i: number, j: number) => ({ x: min.x + ((max.x - min.x) * i) / nx, z: min.z + ((max.z - min.z) * j) / nz });
+  /** How far the surface stands over the ground and `reach` more, sampled at every grid corner: above zero it stands clear. */
+  const sampled = (reach: number) => {
+    const over = (p: Plan) => {
+      if (alongHeld(p)) return -1;
+      const ground = groundAt(p);
+      return ground === undefined ? 1 : surfaceAt(p) - ground - reach;
+    };
+    const values: number[][] = [];
+    let touched = points.some((p) => over(p) <= 0);
+    let clearAnywhere = points.some((p) => over(p) > 0);
+    for (let i = 0; i <= nx; i++) {
+      values.push([]);
+      for (let j = 0; j <= nz; j++) {
+        const p = corner(i, j), v = over(p);
+        values[i]!.push(v);
+        if (!insideFace(topology, p)) continue;
+        if (v <= 0) touched = true;
+        else clearAnywhere = true;
+      }
+    }
+    return { values, touched, clearAnywhere };
+  };
+  const resting = sampled(clearance);
+  if (!resting.touched) return { kind: "none" };
+  if (!resting.clearAnywhere) return { kind: "whole" };
+  // **Partly clear of the ground: cut only where the ground runs through it.**
+  // Resting all over, the ground is cut and meets every side. Standing clear
+  // somewhere -- a floor run out of a hillside -- the ground under the rest
+  // cannot meet a side there, so cutting it down to the resting line would
+  // leave a basin open under the structure. Cut instead where the ground
+  // rises through the surface: there the two meet exactly, and beyond it the
+  // ground runs on under, at its own height.
+  const through = sampled(GROUND_THROUGH_TOLERANCE);
+  if (!through.touched) return { kind: "none" };
+  const values = through.values;
+  const clear: ContactCell[] = [];
+  for (let i = 0; i < nx; i++) {
+    for (let j = 0; j < nz; j++) {
+      const ring = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
+      const v = ring.map(([a, b]) => values[a]![b]!);
+      if (v.every((value) => value <= 0)) continue;
+      if (v.every((value) => value > 0)) {
+        // Exactly the grid's corners, so neighbouring pieces meet point for point and union into one.
+        const p0 = corner(i, j), p1 = corner(i + 1, j + 1);
+        clear.push([[p0.x, p0.z], [p1.x, p0.z], [p1.x, p1.z], [p0.x, p1.z], [p0.x, p0.z]]);
+        continue;
+      }
+      // The clear part of the cell: its clear corners, and where each side crosses the line.
+      const piece: [number, number][] = [];
+      for (let k = 0; k < 4; k++) {
+        const [ai, aj] = ring[k]!, [bi, bj] = ring[(k + 1) % 4]!;
+        const va = v[k]!, vb = v[(k + 1) % 4]!;
+        const a = corner(ai, aj), b = corner(bi, bj);
+        if (va > 0) piece.push([a.x, a.z]);
+        if ((va > 0) !== (vb > 0)) {
+          const t = va / (va - vb);
+          piece.push([a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t]);
+        }
+      }
+      if (piece.length >= 3) clear.push([...piece, piece[0]!]);
+    }
+  }
+  if (clear.length === 0) return { kind: "whole" };
+  return { kind: "part", clear };
+}
+
+/** How finely a structure's footprint is sampled for contact. */
+export const GROUND_CONTACT_CELL = 0.5;
+/** How far around a point the ground's own nodes are read for its height. */
+const GROUND_READ_REACH = 8;
+
+/**
+ * The ground's height over a point in plan, read from `nodes` near it --
+ * weighted by closeness, so the relief there is kept; `undefined` with none
+ * within {@link GROUND_READ_REACH}.
+ */
+export function groundHeightsOf(nodes: readonly ConstructionPosition[], reach = GROUND_READ_REACH): GroundHeightAt {
+  const buckets = new Map<string, ConstructionPosition[]>();
+  const key = (x: number, z: number) => `${Math.floor(x / reach)}:${Math.floor(z / reach)}`;
+  for (const node of nodes) {
+    const bucket = buckets.get(key(node.x, node.z));
+    if (bucket) bucket.push(node);
+    else buckets.set(key(node.x, node.z), [node]);
+  }
+  return (point) => {
+    const column = Math.floor(point.x / reach), row = Math.floor(point.z / reach);
+    let weighted = 0, total = 0;
+    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
+      for (const node of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
+        const distanceSq = (node.x - point.x) ** 2 + (node.z - point.z) ** 2;
+        if (distanceSq < 1e-9) return node.y;
+        if (distanceSq > reach * reach) continue;
+        weighted += node.y / distanceSq;
+        total += 1 / distanceSq;
+      }
+    }
+    return total > 0 ? weighted / total : undefined;
+  };
+}
+
+/** How far round a point with no ground face over it -- a hole the structure itself cut -- the ground's nodes are read for its height. */
+const GROUND_HOLE_REACH = 3;
+
+/**
+ * The ground's own surface over a point in plan: the height of the ground
+ * face it lies in, on that face's plane -- exactly the ground drawn there,
+ * never a blend of relief metres away. A face holding a node of `own` -- the
+ * structures in question, which the ground may have been drawn up to meet --
+ * is not read; where no other face lies over the point -- the middle of a
+ * hole a resting floor cut -- the nearest ground nodes but those answer,
+ * within {@link GROUND_HOLE_REACH}, and failing that within
+ * {@link GROUND_READ_REACH}.
+ */
+export function groundSurfaceOf(ground: readonly ConstructionRegionTopology[], own: ReadonlySet<string>): GroundHeightAt {
+  const faces = ground.filter((topology) => !topology.nodes.some((node) => own.has(node.id))).flatMap((topology) => {
+    const heightAt = surfaceHeightOf(topology);
+    if (!heightAt) return [];
+    const xs = topology.nodes.map((node) => node.position.x), zs = topology.nodes.map((node) => node.position.z);
+    return [{ topology, heightAt, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }];
+  });
+  const size = 4;
+  const buckets = new Map<string, (typeof faces)[number][]>();
+  for (const face of faces) {
+    for (let x = Math.floor(face.minX / size); x <= Math.floor(face.maxX / size); x++) {
+      for (let z = Math.floor(face.minZ / size); z <= Math.floor(face.maxZ / size); z++) {
+        const key = `${x}:${z}`;
+        buckets.set(key, [...(buckets.get(key) ?? []), face]);
+      }
+    }
+  }
+  const rim = ground.flatMap((topology) => topology.nodes).filter((node) => !own.has(node.id)).map((node) => node.position);
+  const nearby = groundHeightsOf(rim, GROUND_HOLE_REACH);
+  const around = groundHeightsOf(rim, GROUND_READ_REACH);
+  return (point) => {
+    for (const face of buckets.get(`${Math.floor(point.x / size)}:${Math.floor(point.z / size)}`) ?? []) {
+      if (point.x < face.minX - 1e-9 || point.x > face.maxX + 1e-9 || point.z < face.minZ - 1e-9 || point.z > face.maxZ + 1e-9) continue;
+      if (insideFace(face.topology, point)) return face.heightAt(point);
+    }
+    return nearby(point) ?? around(point);
+  };
+}
+
+/**
+ * Whether a change to a structure is the business of the `ground` it stands
+ * over at all: the structure touches it now (`after`), touched it before
+ * (`before`) -- the ground it had cut has to heal -- or the ground is still
+ * joined to it by a node. The ground's height is read from the ground alone,
+ * never from the structure's nodes it shares. A structure built, moved or
+ * deleted high over the ground is none of these.
+ */
+export function touchesGround(
+  change: { readonly before: readonly ConstructionRegionTopology[]; readonly after: readonly ConstructionRegionTopology[] },
+  ground: readonly ConstructionRegionTopology[],
+): boolean {
+  const own = new Set([...change.after, ...change.before].flatMap((topology) => topology.nodes.map((node) => node.id)));
+  if (ground.some((topology) => topology.nodes.some((node) => own.has(node.id)))) return true;
+  const groundAt = groundSurfaceOf(ground, own);
+  return [...change.after, ...change.before].some((face) => groundContactOf(face, groundAt, GROUND_CONTACT_CELL).kind !== "none");
+}
```

### `apps/vtt/src/features/edit-construction/topology/ring-simplify.ts`

```diff
diff --git a/apps/vtt/src/features/edit-construction/topology/ring-simplify.ts b/apps/vtt/src/features/edit-construction/topology/ring-simplify.ts
index 65e8a84c..57f258d4 100644
--- a/apps/vtt/src/features/edit-construction/topology/ring-simplify.ts
+++ b/apps/vtt/src/features/edit-construction/topology/ring-simplify.ts
@@ -1,4 +1,13 @@
-import type { ConstructionEdgeGeometry, ConstructionPosition } from "@/ports";
+import type {
+  ChangeOrigin,
+  ConstructionEdgeGeometry,
+  ConstructionPosition,
+  ConstructionRegionTopology,
+  ConstructionSurfaceKey,
+  RegionEditOutcome,
+} from "@/ports";
+import type { AtomicEditOp } from "../orchestration/atomic-edit.ts";
+import { sharedEdgeId } from "./boundary-edges.ts";
 
 /**
  * Drops every vertex of a closed ring that carries no shape of its own -- a
@@ -193,3 +202,109 @@ export function simplifyClosedRing(
   }
   return indices;
 }
+
+/**
+ * Finds the next collinear degree-2 vertex on an unshared straight perimeter edge of a region topology
+ * that can safely be removed via a `remove-vertex` op. Returns `undefined` if the boundary is already minimal.
+ */
+export function planNextCollinearVertexRemoval(
+  topology: ConstructionRegionTopology,
+  allTopologies: readonly ConstructionRegionTopology[],
+  posOf: (nodeId: string) => ConstructionPosition | undefined,
+  tableId: string,
+): { readonly nodeId: string; readonly weldedEdgeId: string } | undefined {
+  if (topology.nodes.length <= 3) return undefined;
+
+  // Node usage across all region boundaries on the tabletop
+  const nodeUsage = new Map<string, number>();
+  for (const t of allTopologies) {
+    for (const loop of [...t.outerLoops, ...t.holes]) {
+      for (const edge of loop) {
+        nodeUsage.set(edge.startNodeId, (nodeUsage.get(edge.startNodeId) ?? 0) + 1);
+        nodeUsage.set(edge.endNodeId, (nodeUsage.get(edge.endNodeId) ?? 0) + 1);
+      }
+    }
+  }
+
+  for (const loop of topology.outerLoops) {
+    if (loop.length <= 3) continue;
+    for (let i = 0; i < loop.length; i++) {
+      const edgeIn = loop[(i - 1 + loop.length) % loop.length]!;
+      const edgeOut = loop[i]!;
+
+      const vertexId = edgeOut.startNodeId;
+      if (edgeIn.endNodeId !== vertexId) continue;
+
+      // Only unshared degree-2 vertices (meaning only the two incident edges on this face use it)
+      if (nodeUsage.get(vertexId) !== 2) continue;
+
+      // Straight line segments only
+      if (!isStraight(edgeIn.geometry) || !isStraight(edgeOut.geometry)) continue;
+
+      const prevId = edgeIn.startNodeId;
+      const nextId = edgeOut.endNodeId;
+      const pPrev = posOf(prevId);
+      const pCurr = posOf(vertexId);
+      const pNext = posOf(nextId);
+      if (!pPrev || !pCurr || !pNext) continue;
+
+      if (!collinear(pPrev, pCurr, pNext)) continue;
+
+      // Positive forward direction along the edge
+      const inX = pCurr.x - pPrev.x;
+      const inZ = pCurr.z - pPrev.z;
+      const outX = pNext.x - pCurr.x;
+      const outZ = pNext.z - pCurr.z;
+      if (inX * outX + inZ * outZ <= 0) continue;
+
+      const weldedEdgeId = sharedEdgeId(tableId, prevId, nextId);
+      return { nodeId: vertexId, weldedEdgeId };
+    }
+  }
+  return undefined;
+}
+
+export interface SimplifiableTopologyRuntime {
+  getAllRegionTopologies?(): readonly ConstructionRegionTopology[];
+  getRegionTopology?(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
+  applyRegionEdit?(ops: readonly AtomicEditOp[], origin: ChangeOrigin, causeId: string): unknown;
+  getSnapshot?(): { readonly tableId?: string; readonly map?: { readonly nodePositions?: ReadonlyMap<string, { readonly position: ConstructionPosition }> } };
+}
+
+/**
+ * Removes redundant collinear degree-2 vertices along straight perimeter edges of a floor
+ * (such as a platform) to prevent edge accumulation when moving or editing the structure.
+ */
+export function simplifyCollinearVertices(
+  runtime: SimplifiableTopologyRuntime,
+  topology: ConstructionRegionTopology,
+  tableId: string,
+  causeId: string,
+): number {
+  if (typeof runtime.applyRegionEdit !== "function" || typeof runtime.getAllRegionTopologies !== "function") return 0;
+  let simplifiedCount = 0;
+  let current: ConstructionRegionTopology | undefined = topology;
+
+  while (current) {
+    const all = runtime.getAllRegionTopologies();
+    const liveNodes = typeof runtime.getSnapshot === "function" ? runtime.getSnapshot().map?.nodePositions : undefined;
+    const posOf = (id: string) => liveNodes?.get(id)?.position ?? current?.nodes.find((n) => n.id === id)?.position;
+
+    const planned = planNextCollinearVertexRemoval(current, all, posOf, tableId);
+    if (!planned) break;
+
+    try {
+      runtime.applyRegionEdit([{
+        kind: "remove-vertex",
+        nodeId: planned.nodeId,
+        weldedEdgeId: planned.weldedEdgeId,
+      }], "local", `${causeId}:simplify`);
+      simplifiedCount++;
+      current = typeof runtime.getRegionTopology === "function" ? runtime.getRegionTopology(current.surfaceKey) : undefined;
+    } catch {
+      break;
+    }
+  }
+  return simplifiedCount;
+}
+
```

### `apps/vtt/src/features/edit-construction/effects/effect-pipeline.ts`

```diff
diff --git a/apps/vtt/src/features/edit-construction/effects/effect-pipeline.ts b/apps/vtt/src/features/edit-construction/effects/effect-pipeline.ts
index bdf7a77c..8c3ae3b3 100644
--- a/apps/vtt/src/features/edit-construction/effects/effect-pipeline.ts
+++ b/apps/vtt/src/features/edit-construction/effects/effect-pipeline.ts
@@ -1,6 +1,7 @@
 import type { ConstructionRegionTopology, ConstructionTopologyBoundsQuery } from "@/ports";
 
 import { resolveCreationInteraction, structureTypeFor } from "../structure-types/registry.ts";
+import { touchesGround } from "../topology/ground-contact.ts";
 import type { Effect, EffectKind, Reaction, ReactionId, ShapeChange } from "./effect.ts";
 
 /**
@@ -96,7 +97,9 @@ function reactionGroups(effect: Effect, regions: readonly ConstructionRegionTopo
     if (group === undefined) groups.set(reactionId, [region]);
     else group.push(region);
   }
-  const byKey = (topology: ConstructionRegionTopology) => topology.surfaceKey.join("<NUL>");
+  // A cut reaches only what the changed structure touches -- now, or before it changed -- never what it stands high over.
+  if (effect.kind === "cut") for (const [reactionId, hits] of groups) if (!touchesGround(effect.change, hits)) groups.delete(reactionId);
+  const byKey = (topology: ConstructionRegionTopology) => topology.surfaceKey.join("\u0000");
   return [...groups]
     .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
     .map(([reactionId, hits]) => [reactionId, hits.sort((left, right) => (byKey(left) < byKey(right) ? -1 : 1))]);
```

### `apps/vtt/src/composition/tabletop/effects/change-area.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/effects/change-area.ts b/apps/vtt/src/composition/tabletop/effects/change-area.ts
index 5f8eb667..a7263b64 100644
--- a/apps/vtt/src/composition/tabletop/effects/change-area.ts
+++ b/apps/vtt/src/composition/tabletop/effects/change-area.ts
@@ -5,6 +5,7 @@ import type { ConstructionRegionEdge, ConstructionRegionTopology } from "@/ports
 import type { PlanarArea, PlanarPolygon, PlanarPort, ShapeChange } from "@/features/edit-construction";
 
 import { planarDifference, planarUnion } from "../../../features/edit-construction/index.ts";
+import { twiceSignedAreaXZ } from "../../../features/edit-construction/index.ts";
 
 /**
  * Where a change actually went, read from its shape alone.
@@ -115,17 +116,6 @@ export function changeAreaOf(port: Partial<PlanarPort>, change: Pick<ShapeChange
   return { claimed: realDifference(planar, is, was), vacated: realDifference(planar, was, is) };
 }
 
-/** Twice the signed area of a ring, closed or not. */
-function twiceArea(ring: readonly (readonly [number, number])[]): number {
-  let twice = 0;
-  for (let index = 0; index < ring.length; index += 1) {
-    const [ax, az] = ring[index]!;
-    const [bx, bz] = ring[(index + 1) % ring.length]!;
-    twice += ax * bz - bx * az;
-  }
-  return twice;
-}
-
 /**
  * The outer ring of an area's largest piece: the one outline a footprint
  * contract carries. Every piece still reaches the reaction through the area
@@ -137,7 +127,7 @@ export function largestOuterRing(area: PlanarArea): readonly (readonly [number,
   for (const piece of area) {
     const ring = piece[0];
     if (ring === undefined || ring.length < 3) continue;
-    const size = Math.abs(twiceArea(ring));
+    const size = Math.abs(twiceSignedAreaXZ(ring));
     if (size > bestArea) {
       bestArea = size;
       best = ring;
```

### `apps/vtt/src/composition/tabletop/effects/effect-commit.ts`

```diff
diff --git a/apps/vtt/src/composition/tabletop/effects/effect-commit.ts b/apps/vtt/src/composition/tabletop/effects/effect-commit.ts
index cfe43302..441b62b5 100644
--- a/apps/vtt/src/composition/tabletop/effects/effect-commit.ts
+++ b/apps/vtt/src/composition/tabletop/effects/effect-commit.ts
@@ -2,17 +2,19 @@
 // test reaches has to spell out any import it needs at run time. A type-only
 // `@/` import is fine -- those are erased.
 import type {
+  ConstructionGraphSnapshot,
   ApplyPatchReplacementRequest,
   ChangeOrigin,
   ConstructionPatchOutcome,
+  ConstructionPosition,
   ConstructionRegionTopology,
   ConstructionSurfaceKey,
   RegionEditOutcome,
 } from "@/ports";
-import type { Effect, Reaction, ReactionId, ReactionRecord, ShapeChange } from "@/features/edit-construction";
+import type { AtomicEditOp, Effect, Reaction, ReactionId, ReactionRecord, ShapeChange } from "@/features/edit-construction";
 import type { TransactionResult } from "../tabletop-runtime.ts";
 
-import { runEffects } from "../../../features/edit-construction/index.ts";
+import { hasTrait, runEffects, settlePatch, simplifyCollinearVertices } from "../../../features/edit-construction/index.ts";
 import { timePhase } from "../commit-timing.ts";
 import { TABLETOP_REACTIONS, type TabletopReactionRuntime } from "./reactions.ts";
 import { shapeChangeOfRemoval, shapeChangeOfReplacement, topologiesOf } from "./shape-change.ts";
@@ -33,6 +35,7 @@ export interface EffectCommitRuntime extends TabletopReactionRuntime {
   applyPatchReplacement(request: ApplyPatchReplacementRequest, origin: ChangeOrigin, causeId: string): ConstructionPatchOutcome;
   removeSurface(request: { readonly surfaceKey: ConstructionSurfaceKey }, origin: ChangeOrigin, causeId: string): RegionEditOutcome;
   getAllRegionTopologies(): readonly ConstructionRegionTopology[];
+  getGraphSnapshot(): Pick<ConstructionGraphSnapshot, "nodes" | "edges">;
 }
 
 export type TabletopReactions = Readonly<Record<ReactionId, Reaction<TabletopReactionRuntime>>>;
@@ -83,16 +86,105 @@ export function commitChange<T>(
 export function commitPatchReplacement(
   runtime: EffectCommitRuntime,
   request: ApplyPatchReplacementRequest,
-  options: CommitOptions,
+  options: CommitOptions & {
+    /** Faces the replacement moves without replacing them -- carried along; each type answers its own move. */
+    readonly carries?: readonly ConstructionSurfaceKey[];
+    /** More of the same change, once the replacement stands and before anything answers it. */
+    readonly afterward?: (outcome: ConstructionPatchOutcome) => void;
+  },
 ): TransactionResult<ConstructionPatchOutcome> {
   const origin = options.origin ?? "local";
   return commitChange(runtime, options, () => {
     const before = topologiesOf(runtime, request.sourceSurfaceKeys);
-    const outcome = runtime.applyPatchReplacement(request, origin, options.transactionId);
+    const carriedBefore = topologiesOf(runtime, options.carries ?? []);
+    // Whatever made the patch, each face it declares keeps its type's law.
+    const settled = { ...request, patch: settlePatch(request.patch, runtime.getGraphSnapshot()) };
+    const outcome = runtime.applyPatchReplacement(settled, origin, options.transactionId);
+    options.afterward?.(outcome);
+    if (carriedBefore.length > 0) dispatchEffects(runtime, movedEffects(runtime, carriedBefore, outcome.removedNodeIds, [], options.transactionId), options.reactions);
     return { value: outcome, change: shapeChangeOfReplacement(runtime, request, before, outcome, options.subtype) };
   });
 }
 
+/** One cut per type among `before`, each from how its faces stood to how they stand now. */
+function movedEffects(runtime: EffectCommitRuntime, before: readonly ConstructionRegionTopology[], removedNodeIds: readonly string[], declaredPositions: readonly ConstructionPosition[], causeId: string): Effect[] {
+  const after = new Map(topologiesOf(runtime, before.map((topology) => topology.surfaceKey)).map((topology) => [topology.surfaceKey.join("\u0000"), topology]));
+  return [...new Set(before.map((topology) => topology.surfaceType))].map((surfaceType): Effect => {
+    const was = before.filter((topology) => topology.surfaceType === surfaceType);
+    const now = was.flatMap((topology) => after.get(topology.surfaceKey.join("\u0000")) ?? []);
+    return { kind: "cut", causeId, change: { surfaceType, before: was, after: now, removedNodeIds, declaredPositions } };
+  });
+}
+
+/**
+ * Applies region edit ops -- a finished drag, a turn, a raise -- and lets
+ * every cloud the edit reaches answer it, atomically: a grounded platform
+ * moved or resized re-cuts the ground it left and the ground it now covers,
+ * exactly as drawing it did. Each type the edit moved emits its own change;
+ * a type that cuts nothing reaches nothing.
+ */
+export function commitRegionEdit(
+  runtime: EffectCommitRuntime & { applyRegionEdit(ops: readonly AtomicEditOp[], origin: ChangeOrigin, causeId: string): RegionEditOutcome },
+  ops: readonly AtomicEditOp[],
+  options: CommitOptions,
+): TransactionResult<RegionEditOutcome> {
+  const origin = options.origin ?? "local";
+  const moved = new Set(ops.flatMap((op) => (op.kind === "move-vertex" ? [op.nodeId] : [])));
+  const before = runtime.getAllRegionTopologies().filter((topology) => topology.nodes.some((node) => moved.has(node.id)));
+  return runtime.transact(options.transactionId, origin, () => {
+    const outcome = runtime.applyRegionEdit(ops, origin, options.transactionId);
+    const declaredPositions = ops.flatMap((op) => (op.kind === "move-vertex" ? [op.position] : []));
+    const effects = movedEffects(runtime, before, outcome.removedNodeIds, declaredPositions, options.transactionId);
+    if (effects.length > 0) dispatchEffects(runtime, effects, options.reactions);
+    if (typeof runtime.getRegionTopology === "function" && typeof runtime.applyRegionEdit === "function") {
+      const tableId = typeof runtime.getSnapshot === "function" ? runtime.getSnapshot().tableId : "table";
+      for (const topology of before) {
+        if (hasTrait(topology.surfaceType, "floor")) {
+          const live = runtime.getRegionTopology(topology.surfaceKey);
+          if (live) simplifyCollinearVertices(runtime, live, tableId, options.transactionId);
+        }
+      }
+    }
+    return outcome;
+  });
+}
+
+/**
+ * A region edit in stages, as one transaction: `before` changes the table
+ * first -- a weld paused -- the ops are then worked out on the table as
+ * `before` left it and applied, every cloud they reach answers them, and
+ * `after` finishes the change -- the weld made again. Throwing anywhere
+ * rolls all of it back.
+ */
+export function commitStagedRegionEdit(
+  runtime: EffectCommitRuntime & { applyRegionEdit(ops: readonly AtomicEditOp[], origin: ChangeOrigin, causeId: string): RegionEditOutcome },
+  stages: { readonly before?: () => void; readonly ops: () => readonly AtomicEditOp[]; readonly after?: () => void },
+  options: CommitOptions,
+): TransactionResult<RegionEditOutcome> {
+  const origin = options.origin ?? "local";
+  return runtime.transact(options.transactionId, origin, () => {
+    stages.before?.();
+    const ops = stages.ops();
+    const moved = new Set(ops.flatMap((op) => (op.kind === "move-vertex" ? [op.nodeId] : [])));
+    const before = runtime.getAllRegionTopologies().filter((topology) => topology.nodes.some((node) => moved.has(node.id)));
+    const outcome = runtime.applyRegionEdit(ops, origin, options.transactionId);
+    const declaredPositions = ops.flatMap((op) => (op.kind === "move-vertex" ? [op.position] : []));
+    const effects = movedEffects(runtime, before, outcome.removedNodeIds, declaredPositions, options.transactionId);
+    if (effects.length > 0) dispatchEffects(runtime, effects, options.reactions);
+    if (typeof runtime.getRegionTopology === "function" && typeof runtime.applyRegionEdit === "function") {
+      const tableId = typeof runtime.getSnapshot === "function" ? runtime.getSnapshot().tableId : "table";
+      for (const topology of before) {
+        if (hasTrait(topology.surfaceType, "floor")) {
+          const live = runtime.getRegionTopology(topology.surfaceKey);
+          if (live) simplifyCollinearVertices(runtime, live, tableId, options.transactionId);
+        }
+      }
+    }
+    stages.after?.();
+    return outcome;
+  });
+}
+
 /** Deletes one surface and lets its own cloud and every cloud it had cut answer, atomically. */
 export function commitSurfaceRemoval(
   runtime: EffectCommitRuntime,
```

### `apps/vtt/src/features/edit-construction/structure-types/structural-cut.ts`

```diff
diff --git a/apps/vtt/src/features/edit-construction/structure-types/structural-cut.ts b/apps/vtt/src/features/edit-construction/structure-types/structural-cut.ts
index 4490dc8c..e331f1ec 100644
--- a/apps/vtt/src/features/edit-construction/structure-types/structural-cut.ts
+++ b/apps/vtt/src/features/edit-construction/structure-types/structural-cut.ts
@@ -71,6 +71,8 @@ export interface StructuralCutRequest {
   }[];
   /** Ground vacated by an acting structure (e.g. road moved off) to be restored as terrain. */
   readonly vacatedArea?: PlanarArea;
+  /** Covered regions whose own shape is stale -- dragged out of place by an edit: replaced, but never laid again where their shape now runs. */
+  readonly staleRegions?: readonly (readonly string[])[];
   /** Optional noise function for base terrain when expanding onto empty ground. */
   readonly noiseAt?: (point: { readonly x: number; readonly z: number }) => number;
 }
```
