import type { ConstructionEdgeGeometry, ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { reverseGeometry } from "./boundary-edges.ts";

/**
 * Curved edges carried along when their end nodes move: an arc whose ends
 * both move alike moves whole, its centre with them; one whose ends move
 * apart keeps its shape -- how far its centre stands off the chord, in
 * chords -- round the new chord. Without this an arc keeps a centre its ends
 * have left, and bends into another curve.
 */
export function arcsFollowing(
  topologies: readonly ConstructionRegionTopology[],
  moves: ReadonlyMap<string, ConstructionPosition>,
): readonly { readonly edgeId: string; readonly geometry: ConstructionEdgeGeometry }[] {
  const retypes = new Map<string, ConstructionEdgeGeometry>();
  for (const topology of topologies) {
    const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
      if (use.geometry.kind !== "arc" || retypes.has(use.edgeId)) continue;
      // In the edge's own direction.
      const own = use.reversed ? reverseGeometry(use.geometry) : use.geometry;
      if (own.kind !== "arc") continue;
      const [startId, endId] = use.reversed ? [use.endNodeId, use.startNodeId] : [use.startNodeId, use.endNodeId];
      if (!moves.has(startId) && !moves.has(endId)) continue;
      const a0 = at.get(startId), b0 = at.get(endId);
      if (!a0 || !b0) continue;
      const a1 = moves.get(startId) ?? a0, b1 = moves.get(endId) ?? b0;
      const da = { x: a1.x - a0.x, z: a1.z - a0.z }, db = { x: b1.x - b0.x, z: b1.z - b0.z };
      const [cx, cz] = own.center;
      if (Math.hypot(da.x - db.x, da.z - db.z) < 1e-9) {
        retypes.set(use.edgeId, { ...own, center: [cx + da.x, cz + da.z] });
        continue;
      }
      const chord0 = Math.hypot(b0.x - a0.x, b0.z - a0.z), chord1 = Math.hypot(b1.x - a1.x, b1.z - a1.z);
      // A closed arc -- both ends on one node -- or one squeezed to nothing has no chord to keep a shape round.
      if (chord0 < 1e-9 || chord1 < 1e-9) continue;
      const n0 = { x: -(b0.z - a0.z) / chord0, z: (b0.x - a0.x) / chord0 }, n1 = { x: -(b1.z - a1.z) / chord1, z: (b1.x - a1.x) / chord1 };
      const m0 = { x: (a0.x + b0.x) / 2, z: (a0.z + b0.z) / 2 }, m1 = { x: (a1.x + b1.x) / 2, z: (a1.z + b1.z) / 2 };
      const off = ((cx - m0.x) * n0.x + (cz - m0.z) * n0.z) / chord0;
      retypes.set(use.edgeId, { ...own, center: [m1.x + n1.x * off * chord1, m1.z + n1.z * off * chord1] });
    }
  }
  return [...retypes].map(([edgeId, geometry]) => ({ edgeId, geometry }));
}
