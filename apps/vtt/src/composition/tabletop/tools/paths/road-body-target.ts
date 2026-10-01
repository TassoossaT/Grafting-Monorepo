import { curvePick, structureTypeFor } from "../../../../features/edit-construction/index.ts";
import { spineBodyTarget } from "../core/spine-body-target.ts";
import type { PointerSample, ToolContext } from "../core/tool-context.ts";
import type { AnchorSnap, AnchorTarget } from "../core/curve-edit-gesture.ts";
import { rulerOf } from "../core/ruler.ts";
import { createSnapMeshPreview } from "./road-preview-mesh.ts";

export interface RoadSnapTarget extends AnchorTarget {
  readonly snapSignature?: string;
  readonly snapEdge?: { readonly edgeId: string; readonly parameter: number };
}
/** How near a road's node, on the screen, a dragged anchor must come to join it -- and the same in metres while the scale is unknown. */
const ROAD_SNAP_PIXELS = 40;
const ROAD_SNAP_FALLBACK = 0.55;
const snapLocks = new WeakMap<ToolContext["runtime"], { target: RoadSnapTarget; signature: string; exitReach: number }>();
function targetSignature(ctx: ToolContext, target: RoadSnapTarget): string | undefined {
  const graph = ctx.runtime.getGraphSnapshot();
  if (target.snapEdge) {
    const edge = graph.edges.find(e => e.edgeId === target.snapEdge!.edgeId);
    if (!edge) return;
    return JSON.stringify([edge, graph.nodes.find(n => n.id === edge.startNodeId), graph.nodes.find(n => n.id === edge.endNodeId)]);
  }
  const node = graph.nodes.find(n => n.id === target.nodeId);
  return node && JSON.stringify(node);
}
/** Keep the displayed position and edge parameter until the pointer exits the wider release zone. */
export function roadSnapTarget(ctx: ToolContext, sample: PointerSample, excludeNodeId?: string): RoadSnapTarget | undefined {
  const previous = snapLocks.get(ctx.runtime);
  if (previous && targetSignature(ctx, previous.target) === previous.signature
      && Math.abs(previous.target.point.y - sample.point.y) <= 1.5
      && Math.hypot(previous.target.point.x - sample.point.x, previous.target.point.z - sample.point.z) <= previous.exitReach) {
    if (!excludeNodeId || previous.target.nodeId !== excludeNodeId) {
      return { ...sample, nodeId: previous.target.nodeId, point: previous.target.point, snapEdge: previous.target.snapEdge, snapSignature: previous.signature };
    }
  }
  snapLocks.delete(ctx.runtime);
  let target = acquireRoadSnap(ctx, sample, excludeNodeId);
  if (target) {
    const signature = targetSignature(ctx, target);
    if (signature) target = { ...target, snapSignature: signature };
    // Held past the reach that took it, by the ruler's own hold: no flicker at the edge.
    const ruler = rulerOf(ctx);
    if (signature) snapLocks.set(ctx.runtime, { target, signature, exitReach: Math.max(ruler.held(ruler.reach(ROAD_SNAP_PIXELS, ROAD_SNAP_FALLBACK)),
      Math.hypot(target.point.x - sample.point.x, target.point.z - sample.point.z) + 0.3) });
  }
  return target;
}

/** A deleted or reshaped target cannot be confirmed from a stale preview. */
export function roadSnapIsCurrent(ctx: ToolContext, target: RoadSnapTarget): boolean {
  return target.snapSignature !== undefined && targetSignature(ctx, target) === target.snapSignature;
}

/** Product snap reach; projection and splitting remain canonical Rust operations. */
function acquireRoadSnap(ctx: ToolContext, sample: PointerSample, excludeNodeId?: string): RoadSnapTarget | undefined {
  const graph = ctx.runtime.getGraphSnapshot();
  const ids = new Set(graph.edges.filter(e => e.curve?.surfaceType && structureTypeFor(e.curve.surfaceType)?.spine).flatMap(e => [e.startNodeId, e.endNodeId]));
  const reach = rulerOf(ctx).reach(ROAD_SNAP_PIXELS, ROAD_SNAP_FALLBACK);
  let best: { node: (typeof graph.nodes)[number]; distance: number } | undefined;
  for (const node of graph.nodes) {
    if (excludeNodeId && node.id === excludeNodeId) continue;
    if (!ids.has(node.id) || Math.abs(node.position.y - sample.point.y) > 1.5) continue;
    const distance = Math.hypot(node.position.x - sample.point.x, node.position.z - sample.point.z);
    if (distance <= reach && (!best || distance < best.distance)) best = { node, distance };
  }
  if (best) return { ...sample, nodeId: best.node.id, point: best.node.position };
  const body = spineBodyTarget(ctx, sample, excludeNodeId);
  if (!body) return;
  const edge = curvePick(body.sample.nodeId!);
  return { ...body.sample, span: true, snapEdge: edge ? { edgeId: edge.edgeId, parameter: body.options.parameter! } : undefined };
}

/** Highlight the exact prospective junction without changing the graph. */
export function showRoadSnap(ctx: ToolContext, target?: PointerSample): void {
  if (!target) { snapLocks.delete(ctx.runtime); ctx.runtime.clearPreview("road-snap"); return; }
  ctx.runtime.showPreview(createSnapMeshPreview(target.point), "road-snap");
}

/** The road network's anchor snap -- onto another road's node or span -- for a spine gesture. */
export const roadAnchorSnap: AnchorSnap = { find: roadSnapTarget, show: showRoadSnap };
