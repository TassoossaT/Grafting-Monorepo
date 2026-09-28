import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

/**
 * Where a structure touches the ground. A structure that cuts the ground --
 * a floor, a ramp, a road -- cuts it only where it touches it: where its
 * surface stands below the ground, or within {@link GROUND_CONTACT_CLEARANCE}
 * above it. A floor high over the terrain leaves the terrain whole under it; a
 * floor on a hillside cuts the hill only where it runs into it, and the ground
 * passes under the rest. Worked out from the geometry every time, so an edit
 * that lifts a structure off the ground frees it, and one that lowers it cuts
 * again -- nothing is stored, nothing asks what the structure is.
 */

/** How far above the ground a structure's surface may stand and still touch it. */
export const GROUND_CONTACT_CLEARANCE = 0.15;

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
 * `cell`: at its corners, and at the middle of every cell of its footprint.
 * A cell whose middle stands clear of the ground is clear; where no ground is
 * known, nothing is touched. A face standing upright is left as it always
 * was -- wholly in contact.
 *
 * A side whose two ends `held` names -- joined to another structure, a
 * ramp's end welded into a floor -- has that structure on its far side and
 * this one on the near side: no ground fits under it too, so the cells along
 * it count as touching, and the ground goes round them.
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
  const touches = (p: Plan) => {
    const ground = groundAt(p);
    return ground !== undefined && surfaceAt(p) <= ground + clearance;
  };
  const points = topology.nodes.map((node) => node.position);
  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
  const max = { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) };
  const clear: ContactCell[] = [];
  let touched = points.some(touches);
  for (let x = min.x; x < max.x; x += cell) {
    for (let z = min.z; z < max.z; z += cell) {
      const x1 = Math.min(x + cell, max.x), z1 = Math.min(z + cell, max.z);
      const middle = { x: (x + x1) / 2, z: (z + z1) / 2 };
      if (!insideFace(topology, middle)) continue;
      if (touches(middle)) { touched = true; continue; }
      if (alongHeld(middle)) continue;
      // Widened a hair, so neighbouring clear cells union into one piece.
      const e = 1e-6;
      clear.push([[x - e, z - e], [x1 + e, z - e], [x1 + e, z1 + e], [x - e, z1 + e], [x - e, z - e]]);
    }
  }
  if (!touched) return { kind: "none" };
  if (clear.length === 0) return { kind: "whole" };
  return { kind: "part", clear };
}

/** How finely a structure's footprint is sampled for contact. */
export const GROUND_CONTACT_CELL = 1;
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
  const groundAt = groundHeightsOf(ground.flatMap((topology) => topology.nodes).filter((node) => !own.has(node.id)).map((node) => node.position));
  return [...change.after, ...change.before].some((face) => groundContactOf(face, groundAt, GROUND_CONTACT_CELL).kind !== "none");
}
