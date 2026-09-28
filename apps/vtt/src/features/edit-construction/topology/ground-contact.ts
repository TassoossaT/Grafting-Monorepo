import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

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

/**
 * How far above the ground a structure's surface may stand and still rest on
 * it, the ground rising to meet it. Well short of a storey, well past the
 * unevenness of ground a floor is drawn on.
 */
export const GROUND_CONTACT_CLEARANCE = 1.5;

type Plan = { readonly x: number; readonly z: number };

/** The ground's height at a point in plan; `undefined` where there is no ground to speak of. */
export type GroundHeightAt = (point: Plan) => number | undefined;

/** One square of a contact sampling grid, as a closed ring. */
export type ContactCell = readonly (readonly [number, number])[];

/** How a face meets the ground: wholly, not at all, or in part -- with the cells of its footprint that stand clear of it. */
export type GroundContact =
  | { readonly kind: "whole" }
  | { readonly kind: "none" }
  | { readonly kind: "part"; readonly clear: readonly ContactCell[] };

/** The height of `topology`'s surface over a point in plan -- its best plane; `undefined` for a face standing upright. */
export function surfaceHeightOf(topology: ConstructionRegionTopology): ((point: Plan) => number) | undefined {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const ring = (topology.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)).filter((p): p is ConstructionPosition => p !== undefined);
  if (ring.length < 3) return undefined;
  // Newell's normal, through the ring's middle.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
  }
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-12 || Math.abs(ny / length) < 0.05) return undefined;
  const c = { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, y: ring.reduce((s, p) => s + p.y, 0) / ring.length, z: ring.reduce((s, p) => s + p.z, 0) / ring.length };
  return (point) => c.y - (nx * (point.x - c.x) + nz * (point.z - c.z)) / ny;
}

/** Whether `p` is inside the face's outline and out of its holes, in plan. */
function insideFace(topology: ConstructionRegionTopology, p: Plan): boolean {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const inRing = (loop: ConstructionRegionTopology["outerLoops"][number]) => {
    let inside = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = at.get(loop[i]!.startNodeId)!, b = at.get(loop[j]!.startNodeId)!;
      if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  return topology.outerLoops.some(inRing) && !topology.holes.some(inRing);
}

/**
 * How `topology` meets the ground `groundAt` describes, sampled on a grid of
 * `cell` over its footprint. Where it gives way from resting to standing
 * clear is found between the samples, by marching squares -- the line where
 * it stands exactly `clearance` over the ground -- so the cut follows it
 * instead of stepping round whole cells, and the ground meets the
 * structure's side right where it lets go. Where no ground is known it is
 * clear. A face standing upright is left as it always was -- wholly in
 * contact.
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
  const alongHeld = (p: Plan) => heldSides.some(([a, b]) => {
    const dx = b.x - a.x, dz = b.z - a.z, lengthSq = dx * dx + dz * dz;
    const t = lengthSq < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
    return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)) < cell;
  });
  /** How far over resting the surface stands: above zero it stands clear. */
  const over = (p: Plan) => {
    if (alongHeld(p)) return -1;
    const ground = groundAt(p);
    return ground === undefined ? 1 : surfaceAt(p) - ground - clearance;
  };
  const points = topology.nodes.map((node) => node.position);
  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
  const max = { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) };
  const nx = Math.max(1, Math.ceil((max.x - min.x) / cell)), nz = Math.max(1, Math.ceil((max.z - min.z) / cell));
  const corner = (i: number, j: number) => ({ x: min.x + ((max.x - min.x) * i) / nx, z: min.z + ((max.z - min.z) * j) / nz });
  const values: number[][] = [];
  let touched = points.some((p) => over(p) <= 0);
  let clearAnywhere = false;
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
  if (!touched) return { kind: "none" };
  if (!clearAnywhere && points.every((p) => over(p) <= 0)) return { kind: "whole" };
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
    return [{ topology, heightAt, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }];
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
  return (point) => {
    for (const face of buckets.get(`${Math.floor(point.x / size)}:${Math.floor(point.z / size)}`) ?? []) {
      if (point.x < face.minX - 1e-9 || point.x > face.maxX + 1e-9 || point.z < face.minZ - 1e-9 || point.z > face.maxZ + 1e-9) continue;
      if (insideFace(face.topology, point)) return face.heightAt(point);
    }
    return nearby(point) ?? around(point);
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
