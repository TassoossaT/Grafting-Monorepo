// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A type-only
// `@/` import is fine -- those are erased.
import type {
  ConstructionCoveredRegion,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionEdge,
  ConstructionRegionTopology,
  ConstructionTopologyBoundsQuery,
} from "@/ports";
import type { AtomicEditOp, CutFallout, Effect, Reaction, ReactionOutcome } from "@/features/edit-construction";

import {
  type ContactCell,
  type GroundContact,
  GROUND_CONTACT_CELL,
  GROUND_CONTACT_CLEARANCE,
  GROUND_SIDE_REST_ROOM,
  GROUND_THROUGH_TOLERANCE,
  groundContactOf,
  groundSurfaceOf,
  hasTrait,
  insideFace,
  nearestOnSegment,
  planTerrainCloudCutRepair,
  planarDifference,
  planarUnion,
  pointInOrOnPolygon,
  sharedEdgeId,
  simplifyCollinearVertices,
  surfaceHeightOf,
  terrainTopologiesBounds,
} from "../../../features/edit-construction/index.ts";
import { timePhase } from "../commit-timing.ts";
import { paintedFalloutOf } from "../interference/painted-topologies.ts";
import { repairTerrainCut, type TerrainRegenerateRuntime } from "./terrain-regenerate.ts";
import { REALLY_MOVED, changeAreaOf, largestOuterRing } from "../effects/change-area.ts";
import type { PlanarArea, PlanarPolygon } from "@/features/edit-construction";

/**
 * The `"lattice-regenerate"` reaction: how a ground cloud answers a change
 * that reached it.
 *
 * Everything here is terrain's own judgement -- which of the reached faces a
 * change actually consumed, which ones it orphaned by abandoning their nodes,
 * and what the regeneration is handed. What reached it, and whether it is
 * allowed to answer, was already decided by the effect pipeline from declared
 * interactions; this never asks which type changed.
 */

/** What regenerating ground needs of the runtime, read and written inside the pipeline's transaction. */
export interface LatticeReactionRuntime extends TerrainRegenerateRuntime {
  getSnapshot(): { readonly tableId: string; readonly map: { readonly nodePositions: ReadonlyMap<string, { readonly position: ConstructionPosition }> } };
  getFootprintCoverage?(polygon: readonly (readonly [number, number])[]): readonly ConstructionCoveredRegion[];
}

/** Regenerates one ground type's consumed faces; returns how many it built. */
export type LatticeRepairExecutor = (
  runtime: TerrainRegenerateRuntime,
  fallout: CutFallout,
  causeId: string,
  tableId: string,
) => number;

const DONE: ReactionOutcome = Object.freeze({ kind: "done" });

function segmentsIntersect(a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], d: readonly [number, number]): boolean {
  const cross = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const between = (p: readonly [number, number], q: readonly [number, number], r: readonly [number, number]) =>
    Math.min(p[0], q[0]) - 1e-7 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-7 &&
    Math.min(p[1], q[1]) - 1e-7 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-7;
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (abC === 0 && between(a, b, c)) || (abD === 0 && between(a, b, d)) ||
    (cdA === 0 && between(c, d, a)) || (cdB === 0 && between(c, d, b)) ||
    ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0));
}

export function topologyIntersectsPolygon(topology: ConstructionRegionTopology, polygon: readonly (readonly [number, number])[]): boolean {
  if (polygon.length < 3 || topology.nodes.length === 0) return false;
  const positions = new Map(topology.nodes.map((node) => [node.id, [node.position.x, node.position.z] as [number, number]]));
  const rings = [...topology.outerLoops, ...topology.holes];
  for (const loop of rings) {
    for (let i = 0; i < loop.length; i += 1) {
      const from = positions.get(loop[i]!.startNodeId);
      const to = positions.get(loop[(i + 1) % loop.length]!.startNodeId);
      if (from === undefined || to === undefined) continue;
      for (let j = 0; j < polygon.length; j += 1) {
        const edgeFrom = polygon[j]!;
        const edgeTo = polygon[(j + 1) % polygon.length]!;
        if (segmentsIntersect(from, to, edgeFrom, edgeTo)) return true;
      }
    }
  }
  const center = topology.nodes.reduce((sum, node) => ({ x: sum.x + node.position.x, z: sum.z + node.position.z }), { x: 0, z: 0 });
  center.x /= topology.nodes.length;
  center.z /= topology.nodes.length;
  return pointInOrOnPolygon(center.x, center.z, polygon) || polygon.some(([x, z]) => {
    return topology.nodes.some((node) => Math.hypot(node.position.x - x, node.position.z - z) < 1e-7);
  });
}

/** Whether any of a face's nodes lies inside an XZ extent -- the engine's own in-bounds rule. */
function hasNodeIn(topology: ConstructionRegionTopology, bounds: ConstructionTopologyBoundsQuery): boolean {
  return topology.nodes.some((node) =>
    node.position.x >= bounds.minX && node.position.x <= bounds.maxX && node.position.z >= bounds.minZ && node.position.z <= bounds.maxZ);
}

/** Even-odd across every ring of a multipolygon, holes included. */
function insideAny(x: number, z: number, polygon: PlanarArea): boolean {
  for (const piece of polygon) {
    let crossings = 0;
    for (const ring of piece) {
      if (pointInOrOnPolygon(x, z, ring)) crossings += 1;
    }
    if (crossings % 2 === 1) return true;
  }
  return false;
}

/** Fast spatial bucketing for proximity queries against a set of points. */
export function pointBucketIndex(points: readonly ConstructionPosition[], cellSize: number) {
  const buckets = new Map<string, ConstructionPosition[]>();
  const key = (x: number, z: number) => `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
  for (const pt of points) {
    const k = key(pt.x, pt.z);
    const list = buckets.get(k);
    if (list === undefined) buckets.set(k, [pt]);
    else list.push(pt);
  }
  const maxDistSq = cellSize * cellSize;

  return {
    isNear(x: number, z: number): boolean {
      const col = Math.floor(x / cellSize);
      const row = Math.floor(z / cellSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const list = buckets.get(`${col + dx}:${row + dz}`);
          if (list !== undefined) {
            for (const pt of list) {
              const ddx = x - pt.x;
              const ddz = z - pt.z;
              if (ddx * ddx + ddz * ddz <= maxDistSq) return true;
            }
          }
        }
      }
      return false;
    },
  };
}

function centroidInside(
  topology: ConstructionRegionTopology,
  cutters: readonly {
    readonly outer: readonly (readonly [number, number])[];
    readonly holes: readonly (readonly (readonly [number, number])[])[];
  }[],
): boolean {
  if (topology.nodes.length === 0) return false;
  const cx = topology.nodes.reduce((sum, n) => sum + n.position.x, 0) / topology.nodes.length;
  const cz = topology.nodes.reduce((sum, n) => sum + n.position.z, 0) / topology.nodes.length;
  return cutters.some((poly) => pointInOrOnPolygon(cx, cz, poly.outer) && !poly.holes.some((h) => pointInOrOnPolygon(cx, cz, h)));
}

function polygonPlanArea(ring: readonly (readonly [number, number])[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(twice) / 2;
}

function filterAreaSlivers(area: PlanarArea, minArea = 0.05): PlanarArea {
  return area.filter((poly) => poly[0] && polygonPlanArea(poly[0]) >= minArea);
}

/** The changed cloud's faces as solid XZ polygons, read at their live node positions. */
/** The changed cloud's faces as solid XZ polygons, read at their live node positions, restricted to where they touch ground. */
function cutterPolygonsOf(
  runtime: LatticeReactionRuntime,
  faces: readonly ConstructionRegionTopology[],
  groundAt?: (p: { readonly x: number; readonly z: number }) => number | undefined,
) {
  const liveNodes = runtime.getSnapshot().map.nodePositions;
  const ringOf = (face: ConstructionRegionTopology, loop: readonly ConstructionRegionEdge[]): [number, number][] => {
    const ring: [number, number][] = [];
    for (const edge of loop) {
      const p = liveNodes.get(edge.startNodeId)?.position ?? face.nodes.find((n) => n.id === edge.startNodeId)?.position;
      if (p) ring.push([p.x, p.z]);
    }
    if (ring.length >= 3) ring.push([ring[0]![0], ring[0]![1]]);
    return ring;
  };
  return faces.flatMap((face) => {
    if (face.outerLoops.length === 0) return [];
    const outer = ringOf(face, face.outerLoops[0]!);
    if (outer.length < 4) return [];
    const holes = face.holes.map((loop) => ringOf(face, loop)).filter((ring) => ring.length >= 4);

    if (groundAt) {
      const contact = groundContactOf(face, groundAt, GROUND_CONTACT_CELL);
      if (contact.kind === "none") return [];
      if (contact.kind === "part" && contact.clear.length > 0) {
        try {
          const clearPolygons: PlanarArea = contact.clear.map((ring) => [ring.map(([x, z]) => [x, z] as [number, number])]);
          const unionClear = planarUnion(runtime, clearPolygons[0]!, ...clearPolygons.slice(1));
          const facePoly: PlanarPolygon = [outer, ...holes];
          const cutArea = filterAreaSlivers(planarDifference(runtime, [facePoly], unionClear));
          return cutArea.map((poly) => ({ outer: poly[0]!, holes: poly.slice(1) }));
        } catch {
          return [{ outer, holes }];
        }
      }
    }
    return [{ outer, holes }];
  });
}

/**
 * What a structure the ground was joined to no longer holds of it: where it
 * stood, when it now touches the ground less than wholly -- lifted off it,
 * tilted out of it. That ground heals, and is cut again only where the
 * structure still touches it; a move across the plan alone is already the
 * change's vacated area.
 */
function letGoOf(runtime: LatticeReactionRuntime, change: Effect["change"], hits: readonly ConstructionRegionTopology[]): PlanarArea {
  const own = new Set([...change.before, ...change.after].flatMap((topology) => topology.nodes.map((node) => node.id)));
  const groundAt = groundSurfaceOf(hits, own);
  const held = new Set(hits.flatMap((topology) => topology.nodes.map((node) => node.id)));
  const after = new Map(change.after.map((face) => [face.surfaceKey.join("\u0000"), face]));
  return change.before.flatMap((face): PlanarArea => {
    if (!face.nodes.some((node) => held.has(node.id))) return [];
    const now = after.get(face.surfaceKey.join("\u0000"));
    if (now && groundContactOf(now, groundAt, GROUND_CONTACT_CELL).kind === "whole") return [];
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    const ring = (face.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined).map((p) => [p.x, p.z] as [number, number]);
    if (ring.length < 3) return [];
    const facePoly: PlanarPolygon = [[...ring, ring[0]!]];
    const beforeContact = groundContactOf(face, groundAt, GROUND_CONTACT_CELL);
    if (beforeContact.kind === "none") return [];
    if (beforeContact.kind === "part" && beforeContact.clear.length > 0) {
      try {
        const clearPolygons: PlanarArea = beforeContact.clear.map((r) => [r.map(([x, z]) => [x, z] as [number, number])]);
        const unionClear = planarUnion(runtime, clearPolygons[0]!, ...clearPolygons.slice(1));
        return filterAreaSlivers(planarDifference(runtime, [facePoly], unionClear));
      } catch {
        return [facePoly];
      }
    }
    return [facePoly];
  });
}

/**
 * How a departing face met the ground it is leaving.
 *
 * For a structure already on the tabletop, ground it cut has been removed
 * (no ground face exists in `hits` inside the cut), while ground it stood
 * clear of remains intact underneath it. Thus:
 * - Where an intact ground face exists in `hits` under the structure, its
 *   height is read; if the structure stood clear above it, it stands clear.
 * - Where no ground face exists in `hits` (inside the terrain's extent), the
 *   ground was cut away by this structure -- so it counts as in-cut, not clear.
 * - Where no ground exists at all (outside the terrain's extent), it stands clear.
 */
function departingGroundContactOf(
  topology: ConstructionRegionTopology,
  hits: readonly ConstructionRegionTopology[],
  cell: number,
  clearance = GROUND_CONTACT_CLEARANCE,
  tolerance = GROUND_SIDE_REST_ROOM,
): GroundContact {
  const surfaceAt = surfaceHeightOf(topology);
  if (!surfaceAt) return { kind: "whole" };
  const points = topology.nodes.map((node) => node.position);
  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
  const max = { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) };
  const nx = Math.max(1, Math.ceil((max.x - min.x) / cell));
  const nz = Math.max(1, Math.ceil((max.z - min.z) / cell));
  const corner = (i: number, j: number) => ({
    x: min.x + ((max.x - min.x) * i) / nx,
    z: min.z + ((max.z - min.z) * j) / nz,
  });

  const hitXs = hits.flatMap((h) => h.nodes.map((n) => n.position.x));
  const hitZs = hits.flatMap((h) => h.nodes.map((n) => n.position.z));
  const bounds = hitXs.length > 0 ? {
    minX: Math.min(...hitXs),
    maxX: Math.max(...hitXs),
    minZ: Math.min(...hitZs),
    maxZ: Math.max(...hitZs),
  } : undefined;

  const size = 4;
  const buckets = new Map<string, ConstructionRegionTopology[]>();
  for (const face of hits) {
    const xs = face.nodes.map((n) => n.position.x);
    const zs = face.nodes.map((n) => n.position.z);
    const fMinX = Math.min(...xs), fMaxX = Math.max(...xs);
    const fMinZ = Math.min(...zs), fMaxZ = Math.max(...zs);
    for (let x = Math.floor(fMinX / size); x <= Math.floor(fMaxX / size); x++) {
      for (let z = Math.floor(fMinZ / size); z <= Math.floor(fMaxZ / size); z++) {
        const key = `${x}:${z}`;
        buckets.set(key, [...(buckets.get(key) ?? []), face]);
      }
    }
  }

  const findFace = (p: { readonly x: number; readonly z: number }) => {
    const list = buckets.get(`${Math.floor(p.x / size)}:${Math.floor(p.z / size)}`);
    if (!list) return undefined;
    for (const t of list) {
      if (insideFace(t, p)) return t;
    }
    return undefined;
  };

  const held = new Set(hits.flatMap((t) => t.nodes.map((n) => n.id)));
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const heldSides = topology.outerLoops.flat().filter((use) => held.has(use.startNodeId) && held.has(use.endNodeId)).map((use) => [at.get(use.startNodeId)!, at.get(use.endNodeId)!] as const);
  const alongHeld = (p: { readonly x: number; readonly z: number }) => heldSides.some(([a, b]) => nearestOnSegment(p, a, b).distance < cell);

  const sampled = (reach: number) => {
    const over = (p: { readonly x: number; readonly z: number }) => {
      if (alongHeld(p)) return -1;
      const face = findFace(p);
      if (!face) {
        if (bounds && (p.x < bounds.minX || p.x > bounds.maxX || p.z < bounds.minZ || p.z > bounds.maxZ)) {
          return 1;
        }
        return -1;
      }
      const gh = surfaceHeightOf(face)?.(p);
      if (gh === undefined) return -1;
      return surfaceAt(p) - gh - reach;
    };
    const values: number[][] = [];
    let touched = points.some((p) => over(p) <= 0);
    let clearAnywhere = points.some((p) => over(p) > 0);
    for (let i = 0; i <= nx; i++) {
      values.push([]);
      for (let j = 0; j <= nz; j++) {
        const p = corner(i, j), v = over(p);
        values[i]!.push(v);
        if (!insideFace(topology, p)) continue;
        if (v <= 0) touched = true;
        else clearAnywhere = true;
      }
    }
    return { values, touched, clearAnywhere };
  };

  const resting = sampled(clearance);
  if (!resting.touched) return { kind: "none" };
  if (!resting.clearAnywhere) return { kind: "whole" };

  const through = sampled(tolerance);
  if (!through.touched) return { kind: "none" };
  const values = through.values;
  const clear: ContactCell[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const ring = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
      const v = ring.map(([a, b]) => values[a]![b]!);
      if (v.every((value) => value <= 0)) continue;
      if (v.every((value) => value > 0)) {
        const p0 = corner(i, j), p1 = corner(i + 1, j + 1);
        clear.push([[p0.x, p0.z], [p1.x, p0.z], [p1.x, p1.z], [p0.x, p1.z], [p0.x, p0.z]]);
        continue;
      }
      const piece: [number, number][] = [];
      for (let k = 0; k < 4; k++) {
        const [ai, aj] = ring[k]!, [bi, bj] = ring[(k + 1) % 4]!;
        const va = v[k]!, vb = v[(k + 1) % 4]!;
        const a = corner(ai, aj), b = corner(bi, bj);
        if (va > 0) piece.push([a.x, a.z]);
        if ((va > 0) !== (vb > 0)) {
          const t = va / (va - vb);
          piece.push([a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t]);
        }
      }
      if (piece.length >= 3) clear.push([...piece, piece[0]!]);
    }
  }
  if (clear.length === 0) return { kind: "whole" };
  return { kind: "part", clear };
}

/**
 * Where a structure left ground it had cut: the plan it vacated, but only of
 * the faces that met the ground where they stood -- joined to it by a node,
 * or resting on it. A face that stood clear of the ground left nothing cut
 * behind; laying the ground again there would only draw its outline into
 * ground nobody touched.
 */
function vacatedGroundOf(
  runtime: LatticeReactionRuntime,
  change: Effect["change"],
  hits: readonly ConstructionRegionTopology[],
  vacated: PlanarArea,
): PlanarArea {
  const held = new Set(hits.flatMap((topology) => topology.nodes.map((node) => node.id)));
  const met = change.before.filter((face) => face.nodes.some((node) => held.has(node.id)) || departingGroundContactOf(face, hits, GROUND_CONTACT_CELL).kind !== "none");
  if (met.length === 0) return [];
  const baseVacated =
    met.length === change.before.length
      ? vacated
      : (changeAreaOf(runtime, { before: met, after: change.after })?.vacated ?? vacated);

  const clearCells: ContactCell[] = [];
  for (const face of met) {
    const contact = departingGroundContactOf(face, hits, GROUND_CONTACT_CELL);
    if (contact.kind === "part") {
      clearCells.push(...contact.clear);
    }
  }
  if (clearCells.length > 0) {
    try {
      const clearPolygons: PlanarArea = clearCells.map((ring) => [ring.map(([x, z]) => [x, z] as [number, number])]);
      const unionClear = planarUnion(runtime, clearPolygons[0]!, ...clearPolygons.slice(1));
      return filterAreaSlivers(planarDifference(runtime, baseVacated, unionClear));
    } catch {
      return baseVacated;
    }
  }
  return baseVacated;
}

/**
 * Where a structure newly claimed ground it cuts: the plan it claimed, but only
 * of the faces that actually touch the ground. Suspended portions standing clear
 * of the ground are subtracted so the ground below remains whole.
 */
function claimedGroundOf(
  runtime: LatticeReactionRuntime,
  change: Effect["change"],
  groundAt: (p: { readonly x: number; readonly z: number }) => number | undefined,
  claimed: PlanarArea,
): PlanarArea {
  if (claimed.length === 0) return [];
  const met = change.after.filter((face) => groundContactOf(face, groundAt, GROUND_CONTACT_CELL).kind !== "none");
  if (met.length === 0) return [];
  const baseClaimed =
    met.length === change.after.length
      ? claimed
      : (changeAreaOf(runtime, { before: change.before, after: met })?.claimed ?? claimed);

  const clearCells: ContactCell[] = [];
  for (const face of met) {
    const contact = groundContactOf(face, groundAt, GROUND_CONTACT_CELL);
    if (contact.kind === "part") {
      clearCells.push(...contact.clear);
    }
  }
  if (clearCells.length > 0) {
    try {
      const clearPolygons: PlanarArea = clearCells.map((ring) => [ring.map(([x, z]) => [x, z] as [number, number])]);
      const unionClear = planarUnion(runtime, clearPolygons[0]!, ...clearPolygons.slice(1));
      return filterAreaSlivers(planarDifference(runtime, baseClaimed, unionClear));
    } catch {
      return baseClaimed;
    }
  }
  return baseClaimed;
}

function answerCut(runtime: LatticeReactionRuntime, effect: Effect, hits: readonly ConstructionRegionTopology[], executor: LatticeRepairExecutor): void {
  const { change } = effect;
  const tableId = runtime.getSnapshot().tableId;

  // Simplify any extra collinear degree-2 vertices on floor/platform perimeters
  if (typeof runtime.applyRegionEdit === "function" && typeof runtime.getRegionTopology === "function") {
    for (const face of change.after) {
      if (hasTrait(face.surfaceType, "floor")) {
        simplifyCollinearVertices(runtime, face, tableId, effect.causeId);
      }
    }
  }
  const afterFaces = typeof runtime.getRegionTopology === "function"
    ? change.after.map((f) => runtime.getRegionTopology(f.surfaceKey) ?? f)
    : change.after;
  const activeChange = { ...change, after: afterFaces };

  const groundTypes = [...new Set(hits.map((hit) => hit.surfaceType))];
  const groundTypeSet = new Set(groundTypes);

  const changedPositions: ConstructionPosition[] = [
    ...afterFaces.flatMap((t) => t.nodes.map((n) => n.position)),
    ...activeChange.before.flatMap((t) => t.nodes.map((n) => n.position)),
    ...activeChange.declaredPositions,
    ...(activeChange.footprintOutline ?? []).map(([x, z]) => ({ x, y: 0, z })),
  ];
  if (changedPositions.length === 0) return;

  // **An edit is scoped by where its shape went, never by what it rebuilt.**
  // A change that replaced standing faces -- any type regenerating a spine or
  // contour component -- produces the whole component again, and any outline
  // the type derives from that names the whole network. Creation replaces
  // nothing, so there the type's own footprint is exactly the new ground.
  // Without a boolean to answer, it falls back to the type's footprint and the
  // change's whole extent: wider, never narrower than what is needed.
  const own = new Set([...activeChange.before, ...afterFaces].flatMap((topology) => topology.nodes.map((node) => node.id)));
  const groundAt = groundSurfaceOf(hits, own);

  const area = activeChange.before.length > 0 ? timePhase("área mudada", () => changeAreaOf(runtime, activeChange)) : undefined;
  const isEdit = area !== undefined;
  const rawClaimed: PlanarArea = area?.claimed ?? [];
  const claimed: PlanarArea = isEdit ? claimedGroundOf(runtime, activeChange, groundAt, rawClaimed) : [];
  const vacOf = isEdit ? vacatedGroundOf(runtime, activeChange, hits, area.vacated) : [];
  const letGo = isEdit ? letGoOf(runtime, activeChange, hits) : [];
  const changed: PlanarArea = [...vacOf, ...letGo];
  const editArea: PlanarArea = [...claimed, ...changed];

  const typeFootprint = activeChange.footprintOutline !== undefined && activeChange.footprintOutline.length >= 3 ? activeChange.footprintOutline : undefined;
  const footprint = isEdit ? largestOuterRing(claimed) : typeFootprint;
  const extentOf = (points: readonly (readonly [number, number])[]) => {
    const margin = 2.5;
    return {
      minX: Math.min(...points.map(([x]) => x)) - margin,
      maxX: Math.max(...points.map(([x]) => x)) + margin,
      minZ: Math.min(...points.map(([, z]) => z)) - margin,
      maxZ: Math.max(...points.map(([, z]) => z)) + margin,
    };
  };
  const editPoints = editArea.flatMap((piece) => piece[0] ?? []);

  // The reach is deliberately broad, but it must not become the repair scope:
  // any node in the box pulled in large ground faces beside long or curved
  // roads and split their whole cloud. The footprint itself decides admission;
  // the planner still includes faces truly covered through its own checks.
  // An edit admits only ground its moved area touches -- every piece of it,
  // not only the one the single-ring footprint names.
  const underFootprint = isEdit
    ? (editPoints.length === 0 ? [] : hits.filter((t) => hasNodeIn(t, extentOf(editPoints)) &&
        editArea.some((piece) => piece[0] !== undefined && topologyIntersectsPolygon(t, piece[0]))))
    : hits.filter((t) => hasNodeIn(t, extentOf(footprint ?? changedPositions.map((p) => [p.x, p.z] as const))) &&
        (footprint === undefined || topologyIntersectsPolygon(t, footprint)));

  const cutters = cutterPolygonsOf(runtime, afterFaces, groundAt);

  const afterNodeIds = new Set(afterFaces.flatMap((t) => t.nodes.map((n) => n.id)));
  const destroyedNodeIds = new Set<ConstructionNodeId>(activeChange.removedNodeIds);
  for (const t of activeChange.before) for (const n of t.nodes) if (!afterNodeIds.has(n.id)) destroyedNodeIds.add(n.id);

  // A destroyed node no new node stands near was genuinely moved or abandoned.
  // A node whose position did not move was merely re-minted, which is no
  // reason to regenerate ground.
  const afterSpatial = pointBucketIndex(afterFaces.flatMap((t) => t.nodes.map((n) => n.position)), REALLY_MOVED);
  const abandonedNodeIds = new Set<ConstructionNodeId>();
  for (const t of activeChange.before) {
    for (const n of t.nodes) {
      if (destroyedNodeIds.has(n.id) && !afterSpatial.isNear(n.position.x, n.position.z)) abandonedNodeIds.add(n.id);
    }
  }

  // **Ground an edit stretched.** An edit keeps its node ids and moves them;
  // ground rimmed by those same nodes was carried along, stretched from where
  // the shape stood to where it went. However far that is, it is rebuilt.
  const beforePositions = new Map(activeChange.before.flatMap((t) => t.nodes.map((n) => [n.id, n.position] as const)));
  const carriedNodeIds = new Set(afterFaces.flatMap((t) => t.nodes.filter((n) => {
    const was = beforePositions.get(n.id);
    // Lifted as much as moved across: ground rimmed by a node raised off it is stretched all the same.
    return was !== undefined && Math.hypot(was.x - n.position.x, was.y - n.position.y, was.z - n.position.z) > REALLY_MOVED;
  }).map((n) => n.id)));

  // **Ground about to be orphaned, wherever it stands.** A change regenerating
  // its whole connected component re-mints every node in it, including the
  // corners ground split into its own edges to share them. Every one of those
  // stops existing, and the ground holding them is mostly nowhere near the
  // footprint -- so the search reaches the whole replaced extent, not the stroke.
  const orphaned: ConstructionRegionTopology[] = [];
  if (activeChange.before.length > 0) {
    const beforeBounds = terrainTopologiesBounds(activeChange.before, 4.0);
    for (const t of hits) {
      if (!hasNodeIn(t, beforeBounds) && !t.nodes.some((n) => carriedNodeIds.has(n.id))) continue;
      const sharesAbandoned = (abandonedNodeIds.size > 0 && t.nodes.some((n) => abandonedNodeIds.has(n.id)))
        || (carriedNodeIds.size > 0 && t.nodes.some((n) => carriedNodeIds.has(n.id)));
      const insideChanged = changed.length > 0 && t.nodes.length > 0 && (
        t.nodes.some((n) => insideAny(n.position.x, n.position.z, changed)) ||
        insideAny(
          t.nodes.reduce((sum, n) => sum + n.position.x, 0) / t.nodes.length,
          t.nodes.reduce((sum, n) => sum + n.position.z, 0) / t.nodes.length,
          changed,
        )
      );
      if (insideChanged || centroidInside(t, cutters) || sharesAbandoned) orphaned.push(t);
    }
  }

  const byKey = new Map<string, ConstructionRegionTopology>();
  for (const t of [...underFootprint, ...orphaned]) byKey.set(t.surfaceKey.join(" "), t);
  const candidateTerrain = [...byKey.values()];
  if (candidateTerrain.length === 0) return;

  const coverageKeys = new Set<string>();
  if (footprint !== undefined && typeof runtime.getFootprintCoverage === "function") {
    for (const entry of runtime.getFootprintCoverage(footprint)) {
      if (!groundTypeSet.has(entry.surfaceType)) continue;
      coverageKeys.add(entry.surfaceKey.join("/"));
      coverageKeys.add(entry.surfaceKey.join(":"));
    }
  }

  const plan = timePhase("plano do reparo", () => planTerrainCloudCutRepair({
    candidateTerrain,
    cutterPositions: footprint !== undefined ? footprint.map(([x, z]) => ({ x, y: 0, z })) : isEdit ? editPoints.map(([x, z]) => ({ x, y: 0, z })) : changedPositions,
    cutterNodeIds: destroyedNodeIds,
    coverageSurfaceKeys: coverageKeys,
    footprintOutline: footprint,
    cutterPolygons: cutters,
  }));
  // Ground the edit dragged along is stale however the planner reads it: it goes.
  const stretched = orphaned.filter((t) => t.nodes.some((n) => carriedNodeIds.has(n.id)));
  if (!plan.requiresRepair && changed.length === 0 && stretched.length === 0) {
    if (typeof runtime.applyRegionEdit === "function" && typeof runtime.getRegionTopology === "function") {
      for (const face of change.after) {
        if (hasTrait(face.surfaceType, "floor")) {
          const live = runtime.getRegionTopology(face.surfaceKey) ?? face;
          simplifyCollinearVertices(runtime, live, tableId, effect.causeId);
        }
      }
    }
    return;
  }

  const painter = afterFaces.length > 0
    ? timePhase("perímetro da mudança", () => paintedFalloutOf(afterFaces))
    : { paintedNodes: [], paintedLoops: [] };

  const consumedByType = new Map(plan.consumedByType);
  for (const t of stretched) {
    const keys = consumedByType.get(t.surfaceType) ?? [];
    if (!keys.some((key) => key.join(" ") === t.surfaceKey.join(" "))) consumedByType.set(t.surfaceType, [...keys, t.surfaceKey]);
  }
  if (consumedByType.size === 0 && changed.length > 0) consumedByType.set(groundTypes[0]!, []);

  // **Where the dragged ground lay, not where it was dragged to.** A face
  // rimmed by a node the edit carried is consumed as it now stands --
  // stretched out to where the node went -- so its own shape no longer covers
  // the ground it covered. That ground is laid again as vacated, or the
  // structure leaves a hole wherever it moves away from.
  const draggedFrom: PlanarArea = stretched.flatMap((topology): PlanarArea => {
    const at = new Map(topology.nodes.map((node) => [node.id, carriedNodeIds.has(node.id) ? beforePositions.get(node.id) ?? node.position : node.position]));
    const ring = (topology.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined).map((p) => [p.x, p.z] as [number, number]);
    return ring.length >= 3 ? [[[...ring, ring[0]!]]] : [];
  });
  const vacatedGround: PlanarArea = [...changed, ...draggedFrom];

  for (const [surfaceType, consumedSurfaceKeys] of consumedByType) {
    timePhase(`regeneração de ${surfaceType}`, () => executor(
      runtime,
      {
        paintedNodes: painter.paintedNodes,
        paintedLoops: painter.paintedLoops,
        consumedSurfaceKeys,
        // The shape the change claimed, and whose type the repair reads again
        // for itself, so it subtracts the changed cloud from the ground it lays
        // instead of laying ground over it.
        footprintOutline: footprint,
        painterSurfaceType: change.surfaceType,
        vacatedGround,
        draggedSurfaceKeys: stretched.filter((topology) => topology.surfaceType === surfaceType).map((topology) => topology.surfaceKey),
      },
      effect.causeId,
      tableId,
    ));
  }

  if (typeof runtime.applyRegionEdit === "function" && typeof runtime.getRegionTopology === "function") {
    for (const face of change.after) {
      if (hasTrait(face.surfaceType, "floor")) {
        const live = runtime.getRegionTopology(face.surfaceKey) ?? face;
        simplifyCollinearVertices(runtime, live, tableId, effect.causeId);
      }
    }
  }
}

/**
 * Builds the reaction around an executor. The default regenerates for real;
 * tests hand in a recorder to see exactly what a regeneration would be given.
 */
export function latticeRegenerateReaction(executor: LatticeRepairExecutor = repairTerrainCut): Reaction<LatticeReactionRuntime> {
  return (runtime, effect, hits) => {
    if (effect.kind === "remove") {
      executor(
        runtime,
        { consumedSurfaceKeys: effect.change.before.map((topology) => topology.surfaceKey), paintedNodes: [], paintedLoops: [] },
        effect.causeId,
        runtime.getSnapshot().tableId,
      );
      return DONE;
    }
    answerCut(runtime, effect, hits, executor);
    return DONE;
  };
}
