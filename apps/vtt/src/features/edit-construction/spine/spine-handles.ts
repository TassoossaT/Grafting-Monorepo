import type { ConstructionCurvedEdge, ConstructionGraphSnapshot } from "@/ports";

import { curvePick } from "../topology/curve-handles.ts";

export { curvePick, curvePickId } from "../topology/curve-handles.ts";

/**
 * Whether `id` names a curve handle or midpoint -- on a spine span or on a
 * curved contour edge -- or an anchor some spine span ends on. Anchors of a
 * contour edge are ordinary vertices, edited through their own role.
 */
export function isBezierEditTarget(snapshot: ConstructionGraphSnapshot, id: string, contour: readonly Pick<ConstructionCurvedEdge, "edgeId">[] = []): boolean {
  const pick = curvePick(id);
  return pick ? snapshot.edges.some((e) => e.edgeId === pick.edgeId && e.curve) || contour.some((edge) => edge.edgeId === pick.edgeId) :
    snapshot.edges.some((e) => e.curve && (e.startNodeId === id || e.endNodeId === id));
}
