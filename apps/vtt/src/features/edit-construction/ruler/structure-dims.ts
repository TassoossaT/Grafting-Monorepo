import type { ConstructionRegionTopology } from "@/ports";

import type { RulerMeasure } from "./resolve.ts";

/**
 * How big a structure is, as the ruler's measures: what is shown of what
 * stands whenever it is pointed at, not only while it is dragged -- so its
 * height and its extent can be read without touching it. Read off the
 * structure's nodes alone: nothing here asks what it is.
 */

/** Smaller than this is not a dimension worth saying: a wall has no thickness to speak of. */
const WORTH_SAYING = 0.05;

/** The way the structure runs in plan: along its longest level straight side, else the world's x axis. */
function runningDirection(faces: readonly ConstructionRegionTopology[]): { readonly x: number; readonly z: number } {
  let best: { x: number; z: number; length: number } | undefined;
  for (const face of faces) {
    const at = new Map(face.nodes.map((node) => [node.id, node.position]));
    for (const use of face.outerLoops.flat()) {
      if (use.geometry.kind !== "line") continue;
      const a = at.get(use.startNodeId), b = at.get(use.endNodeId);
      if (!a || !b || Math.abs(a.y - b.y) > 0.05) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length > (best?.length ?? 0)) best = { x: (b.x - a.x) / length, z: (b.z - a.z) / length, length };
    }
  }
  return best ?? { x: 1, z: 0 };
}

/** The structure `faces` make: how high it is, and how long and deep -- along its own running direction. */
export function dimensionsOf(faces: readonly ConstructionRegionTopology[]): readonly RulerMeasure[] {
  const positions = faces.flatMap((face) => face.nodes.map((node) => node.position));
  if (positions.length === 0) return [];
  const d = runningDirection(faces);
  const n = { x: -d.z, z: d.x };
  const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
  const height = span(positions.map((p) => p.y));
  const length = span(positions.map((p) => p.x * d.x + p.z * d.z));
  const depth = span(positions.map((p) => p.x * n.x + p.z * n.z));
  const measures: RulerMeasure[] = [];
  if (length > WORTH_SAYING) measures.push({ kind: "size", name: "comprimento", meters: length });
  if (depth > WORTH_SAYING) measures.push({ kind: "size", name: "profundidade", meters: depth });
  if (height > WORTH_SAYING) measures.push({ kind: "size", name: "altura", meters: height });
  return measures;
}
