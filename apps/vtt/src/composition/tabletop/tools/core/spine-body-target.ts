import { curveEdgesOf, curvePickId, structureTypeFor } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { CurveGestureOptions } from "./curve-edit-gesture.ts";
import type { PointerSample, ToolContext } from "./tool-context.ts";

/**
 * A pick on a spine-built body, projected onto its spine through the
 * canonical curve query: the nearest control point when the pick is close
 * to one, else the span's midpoint handle at the projected parameter.
 * `ownsSpine` limits it to the spines of the types a tool edits.
 */
export function spineBodyTarget(ctx: ToolContext, sample: PointerSample, excludeNodeId?: string, ownsSpine: (surfaceType: string) => boolean = () => true): { sample: PointerSample; options: CurveGestureOptions } | undefined {
  const hit = ctx.runtime.getAllRegionTopologies().find((t) =>
    structureTypeFor(t.surfaceType)?.spine && ownsSpine(t.surfaceType) && (sample.surfaceRef
      ? surfaceRefFromNodeSet(t.surfaceKey) === sample.surfaceRef
      : t.nodes.some((n) => n.id === sample.nodeId)));
  const owner = hit && structureTypeFor(hit.surfaceType)?.spine;
  const snapshot = ctx.runtime.getGraphSnapshot();
  const ownedEdges = snapshot.edges.filter((e) =>
    e.curve?.surfaceType && ownsSpine(e.curve.surfaceType) &&
    (!owner || structureTypeFor(e.curve.surfaceType)?.spine === owner) &&
    (!excludeNodeId || (e.startNodeId !== excludeNodeId && e.endNodeId !== excludeNodeId)));
  const ownedIds = new Set(ownedEdges.map((e) => e.edgeId));
  const edges = curveEdgesOf(snapshot, [], ctx.runtime).filter((e) => ownedIds.has(e.edgeId));
  if (!edges.length) return;
  const nearest = ctx.runtime.curveBatch({ tolerance: 0.025, commands: edges.map((e) => ({ kind: "nearest" as const, curve: e.curve, point: [sample.point.x, sample.point.y, sample.point.z] as const })) });
  const evaluated = ctx.runtime.curveBatch({ tolerance: 0.025, commands: edges.map((e, i) => ({ kind: "split" as const, curve: e.curve, t: Math.max(0.000001, Math.min(0.999999, nearest[i]!.parameter!)) })) });
  let best: { index: number; distance: number } | undefined;
  evaluated.forEach((result, i) => {
    const p = result.curves[0]!.points[3];
    const distance = Math.hypot(p[0] - sample.point.x, p[1] - sample.point.y, p[2] - sample.point.z);
    if (Math.abs(p[1] - sample.point.y) > 1.5) return;
    const profile = snapshot.edges.find((e) => e.edgeId === edges[i]!.edgeId)!.curve!;
    const reach = Math.max(...profile.bandOffsets.map(Math.abs), ...(profile.endBandOffsets ?? []).map(Math.abs), 0.2) + 0.2;
    if (distance <= reach && (!best || distance < best.distance)) best = { index: i, distance };
  });
  if (!best) return;
  const i = best.index, edge = edges[i]!, t = nearest[i]!.parameter!;
  const projected = evaluated[i]!.curves[0]!.points[3];
  // Reuse anchors by world distance, not a percentage of arbitrarily long spans.
  const nearStart = Math.hypot(...projected.map((v, axis) => v - edge.curve.points[0][axis]!));
  const nearEnd = Math.hypot(...projected.map((v, axis) => v - edge.curve.points[3][axis]!));
  const endpoint = nearStart <= 0.6 && nearStart <= nearEnd ? 0 : nearEnd <= 0.6 ? 3 : undefined;
  const p = endpoint === undefined ? evaluated[i]!.curves[0]!.points[3] : edge.curve.points[endpoint];
  return {
    sample: { ...sample, nodeId: endpoint === 0 ? edge.startNodeId : endpoint === 3 ? edge.endNodeId : curvePickId(edge.edgeId, "midpoint"), point: { x: p[0], y: p[1], z: p[2] } },
    options: {
      mode: "shape",
      parameter: t,
      insertOnClick: false,
      pointerOrigin: sample.point,
      dragThreshold: 5,
    },
  };
}
