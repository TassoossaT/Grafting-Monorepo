import type {
  BezierPort,
  ConstructionCurvedEdge,
  ConstructionEdgeGeometry,
  ConstructionGraphSnapshot,
  ConstructionPosition,
  CubicBezier,
} from "@/ports";

import { curvePoint, curvePosition, resolveCurves } from "./bezier-curve.ts";

/**
 * One bezier handle for every curve on the table, wherever the curve is kept.
 *
 * A curve lives in one of two places. A spine span keeps its handles on the
 * construction graph edge (roads and ramps are regenerated from it); a
 * contour edge keeps them in its own boundary geometry (a curved wall is that
 * geometry). Grabbing, placing and reshaping a handle is the same on both:
 * the same pick ids, the same positions, the same engine commands. Only
 * committing the reshaped curve differs, and that belongs to whoever keeps it.
 */

const HANDLE = "bezier-handle:";
const MIDPOINT = "bezier-midpoint:";

export type CurveHandleIndex = 1 | 2 | "midpoint";

/** Where a curve is kept, which decides how a reshape is committed. */
export type CurveStore = "spine" | "contour";

/** One editable cubic between two anchor nodes. */
export interface CurveEdge {
  readonly edgeId: string;
  readonly store: CurveStore;
  readonly startNodeId: string;
  readonly endNodeId: string;
  readonly curve: CubicBezier;
}

/** The pick id of one curve's handle or midpoint -- a presentation projection, not a graph anchor. */
export function curvePickId(edgeId: string, index: CurveHandleIndex): string {
  return index === "midpoint" ? MIDPOINT + encodeURIComponent(edgeId) : HANDLE + index + ":" + encodeURIComponent(edgeId);
}

export function curvePick(id: string): { edgeId: string; index: CurveHandleIndex } | undefined {
  if (id.startsWith(MIDPOINT)) return { edgeId: decodeURIComponent(id.slice(MIDPOINT.length)), index: "midpoint" };
  if (id.startsWith(HANDLE + "1:") || id.startsWith(HANDLE + "2:")) {
    return { edgeId: decodeURIComponent(id.slice(HANDLE.length + 2)), index: id[HANDLE.length] === "1" ? 1 : 2 };
  }
  return undefined;
}

/** A contour edge's cubic in 3D: its XZ handles, at the height the edge climbs through between its anchors. */
export function contourCurve(edge: ConstructionCurvedEdge): CubicBezier {
  const heightAt = (t: number) => edge.start.y + (edge.end.y - edge.start.y) * t;
  return {
    points: [
      curvePoint(edge.start),
      [edge.handle1[0], heightAt(1 / 3), edge.handle1[1]],
      [edge.handle2[0], heightAt(2 / 3), edge.handle2[1]],
      curvePoint(edge.end),
    ],
  };
}

/** The boundary geometry a contour edge keeps for `curve`, walked from its own start node. */
export function contourGeometry(curve: CubicBezier): ConstructionEdgeGeometry {
  const [, handle1, handle2] = curve.points;
  return { kind: "bezier", handle1: [handle1[0], handle1[2]], handle2: [handle2[0], handle2[2]] };
}

/** Every curve on the table: spine spans resolved from their stored handles, and curved contour edges. */
export function curveEdgesOf(
  snapshot: ConstructionGraphSnapshot,
  contour: readonly ConstructionCurvedEdge[],
  port: Pick<BezierPort, "curveBatch">,
): readonly CurveEdge[] {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node.position]));
  const spans = snapshot.edges.filter((edge) => edge.curve && nodes.has(edge.startNodeId) && nodes.has(edge.endNodeId));
  const resolved = resolveCurves(port, spans.map((edge) => ({ handles: edge.curve!, start: nodes.get(edge.startNodeId)!, end: nodes.get(edge.endNodeId)! })), 0.025);
  return [
    ...spans.map((edge, i): CurveEdge => ({ edgeId: edge.edgeId, store: "spine", startNodeId: edge.startNodeId, endNodeId: edge.endNodeId, curve: resolved[i]!.curves[0]! })),
    ...contour.map((edge): CurveEdge => ({ edgeId: edge.edgeId, store: "contour", startNodeId: edge.startNodeId, endNodeId: edge.endNodeId, curve: contourCurve(edge) })),
  ];
}

/** Each curve's midpoint, as a pickable position, in one engine crossing. */
export function curveHandles(
  edges: readonly CurveEdge[],
  port: Pick<BezierPort, "curveBatch">,
): readonly { readonly id: string; readonly position: ConstructionPosition }[] {
  if (edges.length === 0) return [];
  const halves = port.curveBatch({ tolerance: 0.025, commands: edges.map((edge) => ({ kind: "split" as const, curve: edge.curve, t: 0.5 })) });
  return edges.map((edge, i) => ({
    id: curvePickId(edge.edgeId, "midpoint"),
    position: curvePosition(halves[i]!.curves[0]!.points[3]),
  }));
}

/** `curve` with one handle dragged to `target`, or its midpoint pulled there. */
export function reshapeCurve(
  port: Pick<BezierPort, "curveBatch">,
  curve: CubicBezier,
  index: CurveHandleIndex,
  target: ConstructionPosition,
): CubicBezier {
  const [result] = port.curveBatch({ tolerance: 0.025, commands: [
    index === "midpoint"
      ? { kind: "pull", curve, t: 0.5, target: curvePoint(target) }
      : { kind: "handle", curve, index, target: curvePoint(target), mode: "free", opposite: null },
  ] });
  return result!.curves[0]!;
}

/** A curve flattened to line segments, for a preview. */
export function curveSegments(port: Pick<BezierPort, "curveBatch">, curve: CubicBezier): Float32Array {
  const [result] = port.curveBatch({ tolerance: 0.025, commands: [{ kind: "sample", curves: [curve] }] });
  const samples = result!.samples[0] ?? [];
  const positions: number[] = [];
  for (let k = 1; k < samples.length; k += 1) positions.push(...samples[k - 1]!.position, ...samples[k]!.position);
  return Float32Array.from(positions);
}
