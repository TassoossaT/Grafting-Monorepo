import type { BezierPort, ConstructionGraphSnapshot } from "@/ports";

import { curvePosition, resolveCurves } from "../topology/bezier-curve.ts";

const HANDLE = "bezier-handle:";
const MIDPOINT = "bezier-midpoint:";

/** The pick id of one span's handle or midpoint -- a presentation projection, not a graph anchor. */
export function curvePickId(edgeId: string, index: 1 | 2 | "midpoint"): string {
  return index === "midpoint" ? MIDPOINT + encodeURIComponent(edgeId) : HANDLE + index + ":" + encodeURIComponent(edgeId);
}

export function curvePick(id: string): { edgeId: string; index: 1 | 2 | "midpoint" } | undefined {
  if (id.startsWith(MIDPOINT)) return { edgeId: decodeURIComponent(id.slice(MIDPOINT.length)), index: "midpoint" };
  if (id.startsWith(HANDLE + "1:") || id.startsWith(HANDLE + "2:")) {
    return { edgeId: decodeURIComponent(id.slice(HANDLE.length + 2)), index: id[HANDLE.length] === "1" ? 1 : 2 };
  }
  return undefined;
}

/** Every curve span's two handles and midpoint, whatever structure the spine generates. */
export function bezierPickHandles(snapshot: ConstructionGraphSnapshot, port: BezierPort) {
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n.position]));
  const edges = snapshot.edges.filter((e) => e.curve);
  if (!edges.length) return [];
  const resolved = resolveCurves(port, edges.map((e) => ({ handles: e.curve!, start: nodes.get(e.startNodeId)!, end: nodes.get(e.endNodeId)! })), 0.025);
  return edges.flatMap((e, i) => {
    const curve = resolved[i]!.curves[0]!;
    const halves = port.curveBatch({ tolerance: 0.025, commands: [{ kind: "split", curve, t: 0.5 }] })[0]!;
    return [
      { id: curvePickId(e.edgeId, 1), position: curvePosition(curve.points[1]) },
      { id: curvePickId(e.edgeId, 2), position: curvePosition(curve.points[2]) },
      { id: curvePickId(e.edgeId, "midpoint"), position: curvePosition(halves.curves[0]!.points[3]) },
    ];
  });
}

/** Whether `id` names a curve handle, a span midpoint, or an anchor some curve span ends on. */
export function isBezierEditTarget(snapshot: ConstructionGraphSnapshot, id: string): boolean {
  const pick = curvePick(id);
  return pick ? snapshot.edges.some((e) => e.edgeId === pick.edgeId && e.curve) :
    snapshot.edges.some((e) => e.curve && (e.startNodeId === id || e.endNodeId === id));
}
