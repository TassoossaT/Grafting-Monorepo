import type { ConstructionRegionTopology } from "@/ports";

/**
 * Which ground faces are no height over the plane -- what a carve or fill in
 * three dimensions made: a tunnel's ceiling and walls, the hill standing
 * over it, its floor under that, a bridge's belly.
 *
 * Every planar tool -- adding, digging, flattening, the regeneration round a
 * structure -- lays ground as one height per point of the plane. Handed one
 * of these, it would lay it flat across the tunnel. So they keep them as
 * standing neighbours, their nodes the contour they meet, and never lay them
 * again; the carve and fill brush is what edits them.
 *
 * A face is one when it does not face up -- it faces the side or down -- or
 * when another ground face lies over or under it in plan.
 */

/** How much of its normal a face facing up turns upward, at least. */
const FACES_UP = 0.2;
/** How far apart two faces over one point of the plane are, at least, to be ground over ground. */
const LAYERED = 0.5;

/** Normal by Newell's method, in the faces' own winding. */
function newell(face: ConstructionRegionTopology): { x: number; y: number; z: number } {
  const at = new Map(face.nodes.map((node) => [node.id, node.position]));
  const ring = (face.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)!);
  const n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n;
}

function planRing(face: ConstructionRegionTopology) {
  const at = new Map(face.nodes.map((node) => [node.id, node.position]));
  return (face.outerLoops[0] ?? []).map((use) => at.get(use.startNodeId)!);
}

/** The face's height over a plan point inside it, by its plane; `undefined` outside it. */
function heightOver(ring: readonly { x: number; y: number; z: number }[], x: number, z: number): number | undefined {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  if (!inside) return undefined;
  // Inverse-distance over the corners: enough to tell layers metres apart.
  let weight = 0, sum = 0;
  for (const p of ring) {
    const w = 1 / (Math.hypot(p.x - x, p.z - z) + 1e-6);
    weight += w;
    sum += w * p.y;
  }
  return sum / weight;
}

/** The keys (`surfaceKey.join(" ")`) of the faces among `ground` that are no height over the plane. */
export function overhangingGround(ground: readonly ConstructionRegionTopology[]): ReadonlySet<string> {
  const normals = ground.map(newell);
  // Which way the ground's winding turns up: the way most of it faces.
  const up = Math.sign(normals.reduce((sum, n) => sum + n.y, 0)) || -1;
  const rings = ground.map(planRing);
  const centres = rings.map((ring) => ({
    x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
    y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
    z: ring.reduce((s, p) => s + p.z, 0) / ring.length,
  }));
  const over = new Set<number>();
  ground.forEach((_, i) => {
    const n = normals[i]!;
    if (n.y * up < FACES_UP * Math.hypot(n.x, n.y, n.z)) over.add(i);
  });
  // Ground over ground: a face whose middle another face lies over or under.
  const size = 4;
  const buckets = new Map<string, number[]>();
  rings.forEach((ring, i) => {
    const xs = ring.map((p) => p.x), zs = ring.map((p) => p.z);
    for (let x = Math.floor(Math.min(...xs) / size); x <= Math.floor(Math.max(...xs) / size); x++) {
      for (let z = Math.floor(Math.min(...zs) / size); z <= Math.floor(Math.max(...zs) / size); z++) {
        const key = `${x}:${z}`;
        buckets.set(key, [...(buckets.get(key) ?? []), i]);
      }
    }
  });
  centres.forEach((c, i) => {
    for (const j of buckets.get(`${Math.floor(c.x / size)}:${Math.floor(c.z / size)}`) ?? []) {
      if (j === i) continue;
      const h = heightOver(rings[j]!, c.x, c.z);
      if (h !== undefined && Math.abs(h - c.y) > LAYERED) {
        over.add(i);
        over.add(j);
      }
    }
  });
  return new Set([...over].map((i) => ground[i]!.surfaceKey.join(" ")));
}
