import type { ConstructionGraphSnapshot, ConstructionPosition } from "@/ports";

/**
 * `position` for the spine anchor `nodeId`, its height held so no span from
 * it to a neighbouring anchor climbs steeper than `maxGrade` -- rise per plan
 * length between the two anchors. A span's own length is never shorter than
 * the line between its anchors, so the span is held at least as gently.
 *
 * Where its neighbours pull apart -- one far above, one far below -- it
 * settles between them. Plan position is never touched: only the height
 * gives way, the same as a road drawn toward one too high to climb to.
 */
export function holdSpineGrade(snapshot: ConstructionGraphSnapshot, nodeId: string, position: ConstructionPosition, maxGrade: number): ConstructionPosition {
  const positions = new Map(snapshot.nodes.map((node) => [node.id, node.position]));
  let low = -Infinity;
  let high = Infinity;
  for (const edge of snapshot.edges) {
    if (!edge.curve || (edge.startNodeId !== nodeId && edge.endNodeId !== nodeId)) continue;
    const other = positions.get(edge.startNodeId === nodeId ? edge.endNodeId : edge.startNodeId);
    if (!other) continue;
    const reach = maxGrade * Math.hypot(position.x - other.x, position.z - other.z);
    low = Math.max(low, other.y - reach);
    high = Math.min(high, other.y + reach);
  }
  if (low === -Infinity) return position;
  const y = low <= high ? Math.min(high, Math.max(low, position.y)) : (low + high) / 2;
  return y === position.y ? position : { ...position, y };
}
