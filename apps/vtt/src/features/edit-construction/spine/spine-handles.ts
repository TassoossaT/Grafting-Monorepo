import type { ConstructionCurvedEdge, ConstructionEdgeSnapshot, ConstructionGraphSnapshot, ConstructionPosition } from "@/ports";

import { curvePick, curveEndWidthId, curveWidthPickId, type CurveMidframe } from "../topology/curve-handles.ts";
import { spanOffsets } from "./spine-ribbons.ts";

export { curvePick, curvePickId, curveWidthPick, curveWidthPickId } from "../topology/curve-handles.ts";

/** The band's offsets a spine's owner sweeps a span at when the span keeps none of its own. */
export type SpineDefaultOffsets = (surfaceType: string) => readonly number[] | undefined;

/** How wide the band `edge` sweeps is halfway along it, and how far its farther side stands from the spine there. */
export function spanWidth(edge: Pick<ConstructionEdgeSnapshot, "curve">, defaultsFor: SpineDefaultOffsets): { readonly width: number; readonly reach: number } | undefined {
  const defaults = edge.curve?.surfaceType === undefined ? undefined : defaultsFor(edge.curve.surfaceType);
  if (!edge.curve || !defaults) return undefined;
  const { offsets, endOffsets } = spanOffsets(edge.curve, defaults);
  const inner = (offsets[0] + endOffsets[0]) / 2, outer = (offsets[1] + endOffsets[1]) / 2;
  return { width: outer - inner, reach: Math.max(outer, -inner) };
}

/**
 * Each spine span's width handle: on the edge of its band, halfway along
 * it -- pushed out or in, it widens or narrows that span.
 */
export function spineWidthHandles(
  frames: readonly CurveMidframe[],
  graph: ConstructionGraphSnapshot,
  defaultsFor: SpineDefaultOffsets,
  atEnd = false,
): readonly { readonly id: string; readonly position: ConstructionPosition }[] {
  const edges = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  return frames.flatMap(({ edge: span, position: midpoint, tangent: midTangent }) => {
    const edge = span.store === "spine" ? edges.get(span.edgeId) : undefined;
    const width = edge && spanWidth(edge, defaultsFor);
    const defaults = edge?.curve?.surfaceType ? defaultsFor(edge.curve.surfaceType) : undefined;
    const [, , before, end] = span.curve.points;
    const position = atEnd ? { x: end[0], y: end[1], z: end[2] } : midpoint;
    const tangent = atEnd ? [end[0] - before[0], end[1] - before[1], end[2] - before[2]] : midTangent;
    const length = Math.hypot(tangent[0], tangent[2]);
    if (!width || length < 1e-9) return [];
    const reach = atEnd && edge?.curve && defaults ? spanOffsets(edge.curve, defaults).endOffsets[1] : width.reach;
    const side = { x: -tangent[2] / length, z: tangent[0] / length };
    return [{ id: atEnd ? curveEndWidthId(span.edgeId) : curveWidthPickId(span.edgeId), position: { x: position.x + side.x * reach, y: position.y, z: position.z + side.z * reach } }];
  });
}

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
