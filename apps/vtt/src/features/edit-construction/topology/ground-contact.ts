import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { faceRings, insideFace, nearestOnSegment, planeOf } from "./plan-geometry.ts";

/**
 * Where a structure rests on the ground. A structure that cuts the ground --
 * a floor, a ramp, a road -- cuts it only where it rests on it: where its
 * surface stands below the ground, or no more than
 * {@link GROUND_CONTACT_CLEARANCE} above it. There the ground is cut and
 * rises or falls to meet its edge -- a foundation. A floor high over the
 * terrain, a storey, leaves the terrain whole under it; a floor on a
 * hillside cuts the hill only where it rests on it, and the ground passes
 * under the rest. Worked out from the geometry every time, so an edit
 * that lifts a structure off the ground frees it, and one that lowers it cuts
 * again -- nothing is stored, nothing asks what the structure is.
 */

/*
 * Calibration. These values are global for now: every cutting type reads the
 * same ones. They are to move into the VTT's global calibration menu, and
 * later to be declared per type and per interaction -- a road and a platform,
 * a creation and an edit, meeting the ground differently (see `cut` in
 * `structure-types/creation-interaction.ts`).
 */

/**
 * How far above the ground a structure's surface may stand and still rest on
 * it, the ground rising to meet it. Well short of a storey, well past the
 * unevenness of ground a floor is drawn on.
 */
export const GROUND_CONTACT_CLEARANCE = 1.5;
/**
 * How near the ground a surface standing partly clear of it may run and still
 * count as the ground rising through it -- a floor laid flush on the ground,
 * whose every sample would otherwise flicker in and out of it, or a road
 * along a crest with the ground falling a hand away under each side: at 5 cm
 * it was cut in a strip down its middle, the ground running on under its
 * sides and meeting nothing.
 */
export const GROUND_THROUGH_TOLERANCE = 0.3;
/** How far past the resting line a ground corner on a structure's side may stand and still meet the side. */
export const GROUND_SIDE_REST_ROOM = 0.25;

type Plan = { readonly x: number; readonly z: number };

/** The ground's height at a point in plan; `undefined` where there is no ground to speak of. */
/**
 * The ground's height over a point in plan. Given the height of what stands
 * there -- `reference` -- the ground that is that thing's own business: the
 * first surface over it when that faces up (it is sunk in the ground there),
 * else the first under it. A cave's ceiling over a floor is never its ground.
 */
export type GroundHeightAt = (point: Plan, reference?: number) => number | undefined;

/**
 * Of the ground surfaces over one point -- each its height there and whether
 * it faces up -- the one a thing at `reference` meets: the nearest over it
 * if that faces up, the thing being sunk in the ground there; else the
 * nearest under it; `undefined` with neither, a ceiling alone over it.
 */
export function groundLayerAt(layers: readonly { readonly height: number; readonly facesUp: boolean }[], reference: number): number | undefined {
  let over: { readonly height: number; readonly facesUp: boolean } | undefined;
  let under: number | undefined;
  for (const layer of layers) {
    if (layer.height > reference + 1e-6) {
      if (over === undefined || layer.height < over.height) over = layer;
    } else if (under === undefined || layer.height > under) {
      under = layer.height;
    }
  }
  return over?.facesUp ? over.height : under;
}

/** Whether a ground face faces up: the tabletop winds ground with its right-hand normal pointing down. */
export function facesUp(topology: ConstructionRegionTopology): boolean {
  const ring = faceRings(topology)[0] ?? [];
  let y = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    y += (a.z - b.z) * (a.x + b.x);
  }
  return y < 0;
}

/** One square of a contact sampling grid, as a closed ring. */
export type ContactCell = readonly (readonly [number, number])[];

/** How a face meets the ground: wholly, not at all, or in part -- with the cells of its footprint that stand clear of it. */
export type GroundContact =
  | { readonly kind: "whole" }
  | { readonly kind: "none" }
  | { readonly kind: "part"; readonly clear: readonly ContactCell[] };

/** The height of `topology`'s surface over a point in plan -- its best plane; `undefined` for a face standing upright. */
export function surfaceHeightOf(topology: ConstructionRegionTopology): ((point: Plan) => number) | undefined {
  const plane = planeOf(faceRings(topology)[0] ?? []);
  if (!plane || Math.abs(plane.normal.y) < 0.05) return undefined;
  const { normal: n, centre: c } = plane;
  return (point) => c.y - (n.x * (point.x - c.x) + n.z * (point.z - c.z)) / n.y;
}



/**
 * How `topology` meets the ground `groundAt` describes, sampled on a grid of
 * `cell` over its footprint. Within `clearance` of the ground all over, it
 * rests wholly. Standing clear somewhere, it is cut only where the ground
 * runs through it: that line is found between the samples, by marching
 * squares, so the cut follows it instead of stepping round whole cells.
 * Where no ground is known it is clear. A face standing upright is left as
 * it always was -- wholly in contact.
 *
 * A side whose two ends `held` names -- joined to another structure, a
 * ramp's end welded into a floor -- has that structure on its far side and
 * this one on the near side: no ground fits under it too, so it counts as
 * touching for a cell round it, and the ground goes round.
 */
export function groundContactOf(topology: ConstructionRegionTopology, groundAt: GroundHeightAt, cell: number, clearance = GROUND_CONTACT_CLEARANCE, held: ReadonlySet<string> = new Set()): GroundContact {
  const surfaceAt = surfaceHeightOf(topology);
  if (!surfaceAt) return { kind: "whole" };
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const heldSides = topology.outerLoops.flat().filter((use) => held.has(use.startNodeId) && held.has(use.endNodeId)).map((use) => [at.get(use.startNodeId)!, at.get(use.endNodeId)!] as const);
  const alongHeld = (p: Plan) => heldSides.some(([a, b]) => nearestOnSegment(p, a, b).distance < cell);
  const points = topology.nodes.map((node) => node.position);
  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
  const max = { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) };
  const nx = Math.max(1, Math.ceil((max.x - min.x) / cell)), nz = Math.max(1, Math.ceil((max.z - min.z) / cell));
  const corner = (i: number, j: number) => ({ x: min.x + ((max.x - min.x) * i) / nx, z: min.z + ((max.z - min.z) * j) / nz });
  /** How far the surface stands over the ground and `reach` more, sampled at every grid corner: above zero it stands clear. */
  const sampled = (reach: number) => {
    const over = (p: Plan) => {
      if (alongHeld(p)) return -1;
      const ground = groundAt(p, surfaceAt(p));
      return ground === undefined ? 1 : surfaceAt(p) - ground - reach;
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
  // **Partly clear of the ground: cut only where the ground runs through it.**
  // Resting all over, the ground is cut and meets every side. Standing clear
  // somewhere -- a floor run out of a hillside -- the ground under the rest
  // cannot meet a side there, so cutting it down to the resting line would
  // leave a basin open under the structure. Cut instead where the ground
  // rises through the surface: there the two meet exactly, and beyond it the
  // ground runs on under, at its own height.
  const through = sampled(GROUND_THROUGH_TOLERANCE);
  if (!through.touched) return { kind: "none" };
  const values = through.values;
  const clear: ContactCell[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const ring = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
      const v = ring.map(([a, b]) => values[a]![b]!);
      if (v.every((value) => value <= 0)) continue;
      if (v.every((value) => value > 0)) {
        // Exactly the grid's corners, so neighbouring pieces meet point for point and union into one.
        const p0 = corner(i, j), p1 = corner(i + 1, j + 1);
        clear.push([[p0.x, p0.z], [p1.x, p0.z], [p1.x, p1.z], [p0.x, p1.z], [p0.x, p0.z]]);
        continue;
      }
      // The clear part of the cell: its clear corners, and where each side crosses the line.
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

/** How finely a structure's footprint is sampled for contact. */
export const GROUND_CONTACT_CELL = 0.5;
/** How far around a point the ground's own nodes are read for its height. */
const GROUND_READ_REACH = 8;

/**
 * The ground's height over a point in plan, read from `nodes` near it --
 * weighted by closeness, so the relief there is kept; `undefined` with none
 * within {@link GROUND_READ_REACH}.
 */
export function groundHeightsOf(nodes: readonly ConstructionPosition[], reach = GROUND_READ_REACH): GroundHeightAt {
  const buckets = new Map<string, ConstructionPosition[]>();
  const key = (x: number, z: number) => `${Math.floor(x / reach)}:${Math.floor(z / reach)}`;
  for (const node of nodes) {
    const bucket = buckets.get(key(node.x, node.z));
    if (bucket) bucket.push(node);
    else buckets.set(key(node.x, node.z), [node]);
  }
  return (point) => {
    const column = Math.floor(point.x / reach), row = Math.floor(point.z / reach);
    let weighted = 0, total = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const node of buckets.get(`${column + dx}:${row + dz}`) ?? []) {
        const distanceSq = (node.x - point.x) ** 2 + (node.z - point.z) ** 2;
        if (distanceSq < 1e-9) return node.y;
        if (distanceSq > reach * reach) continue;
        weighted += node.y / distanceSq;
        total += 1 / distanceSq;
      }
    }
    return total > 0 ? weighted / total : undefined;
  };
}

/** How far round a point with no ground face over it -- a hole the structure itself cut -- the ground's nodes are read for its height. */
const GROUND_HOLE_REACH = 3;

/**
 * The ground's own surface over a point in plan: the height of the ground
 * face it lies in, on that face's plane -- exactly the ground drawn there,
 * never a blend of relief metres away. A face holding a node of `own` -- the
 * structures in question, which the ground may have been drawn up to meet --
 * is not read; where no other face lies over the point -- the middle of a
 * hole a resting floor cut -- the nearest ground nodes but those answer,
 * within {@link GROUND_HOLE_REACH}, and failing that within
 * {@link GROUND_READ_REACH}.
 */
export function groundSurfaceOf(ground: readonly ConstructionRegionTopology[], own: ReadonlySet<string>): GroundHeightAt {
  const faces = ground.filter((topology) => !topology.nodes.some((node) => own.has(node.id))).flatMap((topology) => {
    const heightAt = surfaceHeightOf(topology);
    if (!heightAt) return [];
    const xs = topology.nodes.map((node) => node.position.x), zs = topology.nodes.map((node) => node.position.z);
    return [{ topology, heightAt, up: facesUp(topology), minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }];
  });
  const size = 4;
  const buckets = new Map<string, (typeof faces)[number][]>();
  for (const face of faces) {
    for (let x = Math.floor(face.minX / size); x <= Math.floor(face.maxX / size); x++) {
      for (let z = Math.floor(face.minZ / size); z <= Math.floor(face.maxZ / size); z++) {
        const key = `${x}:${z}`;
        buckets.set(key, [...(buckets.get(key) ?? []), face]);
      }
    }
  }
  const rim = ground.flatMap((topology) => topology.nodes).filter((node) => !own.has(node.id)).map((node) => node.position);
  const nearby = groundHeightsOf(rim, GROUND_HOLE_REACH);
  const around = groundHeightsOf(rim, GROUND_READ_REACH);
  // Where a thing stands, the rim of a hole it cut is read from below and
  // round it only: a ceiling's rim over it is no ground of its own.
  const rimUnder = (reference: number) => {
    const low = rim.filter((node) => node.y <= reference + GROUND_CONTACT_CLEARANCE);
    return { nearby: groundHeightsOf(low, GROUND_HOLE_REACH), around: groundHeightsOf(low, GROUND_READ_REACH) };
  };
  const rimCache = new Map<number, ReturnType<typeof rimUnder>>();
  return (point, reference) => {
    const layers: { height: number; facesUp: boolean }[] = [];
    for (const face of buckets.get(`${Math.floor(point.x / size)}:${Math.floor(point.z / size)}`) ?? []) {
      if (point.x < face.minX - 1e-9 || point.x > face.maxX + 1e-9 || point.z < face.minZ - 1e-9 || point.z > face.maxZ + 1e-9) continue;
      if (!insideFace(face.topology, point)) continue;
      if (reference === undefined) return face.heightAt(point);
      layers.push({ height: face.heightAt(point), facesUp: face.up });
    }
    if (reference === undefined) return nearby(point) ?? around(point);
    if (layers.length > 0) return groundLayerAt(layers, reference);
    const key = Math.round(reference * 100);
    let low = rimCache.get(key);
    if (!low) rimCache.set(key, (low = rimUnder(reference)));
    return low.nearby(point) ?? low.around(point);
  };
}

/**
 * Whether a change to a structure is the business of the `ground` it stands
 * over at all: the structure touches it now (`after`), touched it before
 * (`before`) -- the ground it had cut has to heal -- or the ground is still
 * joined to it by a node. The ground's height is read from the ground alone,
 * never from the structure's nodes it shares. A structure built, moved or
 * deleted high over the ground is none of these.
 */
export function touchesGround(
  change: { readonly before: readonly ConstructionRegionTopology[]; readonly after: readonly ConstructionRegionTopology[] },
  ground: readonly ConstructionRegionTopology[],
): boolean {
  const own = new Set([...change.after, ...change.before].flatMap((topology) => topology.nodes.map((node) => node.id)));
  if (ground.some((topology) => topology.nodes.some((node) => own.has(node.id)))) return true;
  const groundAt = groundSurfaceOf(ground, own);
  return [...change.after, ...change.before].some((face) => groundContactOf(face, groundAt, GROUND_CONTACT_CELL).kind !== "none");
}
