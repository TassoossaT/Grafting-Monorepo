import type { BezierPort, ConstructionCurvedEdge, ConstructionEdgeSnapshot, ConstructionGraphSnapshot, ConstructionPosition } from "@/ports";

import { curvePick, curveWidthPickId, type CurveEdge } from "../topology/curve-handles.ts";
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
  spans: readonly CurveEdge[],
  graph: ConstructionGraphSnapshot,
  port: Pick<BezierPort, "curveBatch">,
  defaultsFor: SpineDefaultOffsets,
): readonly { readonly id: string; readonly position: ConstructionPosition }[] {
  const edges = new Map(graph.edges.map((edge) => [edge.edgeId, edge]));
  const sized = spans.flatMap((span) => {
    const edge = span.store === "spine" ? edges.get(span.edgeId) : undefined;
    const width = edge && spanWidth(edge, defaultsFor);
    return width ? [{ span, reach: width.reach }] : [];
  });
  if (sized.length === 0) return [];
  const halves = port.curveBatch({ tolerance: 0.025, commands: sized.map(({ span }) => ({ kind: "split" as const, curve: span.curve, t: 0.5 })) });
  return sized.flatMap(({ span, reach }, i) => {
    const [, , before, mid] = halves[i]!.curves[0]!.points;
    const dx = mid[0] - before[0], dz = mid[2] - before[2], length = Math.hypot(dx, dz);
    if (length < 1e-9) return [];
    const side = { x: -dz / length, z: dx / length };
    return [{ id: curveWidthPickId(span.edgeId), position: { x: mid[0] + side.x * reach, y: mid[1], z: mid[2] + side.z * reach } }];
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
