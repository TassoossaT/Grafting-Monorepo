import { DEFAULT_TOOL_PARAMS } from "../../../../features/edit-construction/index.ts";
import type { ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPlanarShape, ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import { boundaryUsage, createBoundaryEdges } from "../core/boundary-edges.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { polylineSegmentsPreview } from "../shapes/preview-shapes.ts";

type Params = ToolParamsByTool["platform-contour"];
const drafts = new WeakMap<object, { key: string; points: PointerSample[] }>();
function draft(ctx: ToolContext, params: Params): PointerSample[] {
  const key = `${params.mode}:${params.elevation}`;
  let current = drafts.get(ctx.runtime);
  if (!current || current.key !== key) { current = { key, points: [] }; drafts.set(ctx.runtime, current); }
  return current.points;
}
function shapeOf(topology: ConstructionRegionTopology): ConstructionPlanarShape {
  const nodes = new Map(topology.nodes.map((node) => [node.id, node.position]));
  return [...topology.outerLoops, ...topology.holes].map((loop) => loop.map((edge) => {
    const p = nodes.get(edge.startNodeId)!;
    return [p.x, p.z] as const;
  }));
}

/** Creates, extends or cuts only the explicitly chosen horizontal level.
 * Existing structural seams survive extension, so enclosed support vertices
 * retain their real membership instead of becoming detached interior points. */
export function commitPlatformContour(ctx: ToolContext, samples: readonly PointerSample[], params: Params): void {
  if (samples.length < 3) return;
  try {
    if (!Number.isFinite(params.elevation)) throw new Error("A elevacao deve ser finita.");
    const all = ctx.runtime.getAllRegionTopologies();
    const graph = ctx.runtime.getGraphSnapshot();
    const picked = new Set(samples.flatMap((sample) => sample.nodeId ? [sample.nodeId] : []));
    for (const node of graph.nodes) {
      if (picked.has(node.id) && Math.abs(node.position.y - params.elevation) > 1e-4) {
        throw new Error("Escolha vertices na elevacao da plataforma; andares diferentes nao sao soldados.");
      }
    }
    const outline = samples.map((sample) => [sample.point.x, sample.point.z] as const);
    const xs = outline.map((p) => p[0]), zs = outline.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const sources = params.mode === "create" ? [] : all.filter((topology) => {
      if (topology.surfaceType !== "platform" || topology.nodes.some((node) => Math.abs(node.position.y - params.elevation) > 1e-4)) return false;
      const x = topology.nodes.map((n) => n.position.x), z = topology.nodes.map((n) => n.position.z);
      return Math.min(...x) <= maxX && Math.max(...x) >= minX && Math.min(...z) <= maxZ && Math.max(...z) >= minZ;
    });
    if (params.mode === "cut" && sources.length === 0) throw new Error("Nenhuma plataforma nessa elevacao para recortar.");
    const shapes = ctx.runtime.planarBoolean({ subject: sources.map(shapeOf), clip: [[outline]], operation: params.mode === "cut" ? "difference" : params.mode === "extend" ? "extend" : "union" });
    if (params.mode !== "cut" && shapes.length === 0) throw new Error("O contorno precisa delimitar uma area.");
    const operationId = scopedToolId(ctx, "platform", ctx.nextSequence());
    const retained = new Map(sources.flatMap((topology) => topology.nodes.map((node) => [node.id, node] as const)));
    for (const node of graph.nodes) if (picked.has(node.id)) retained.set(node.id, node);
    const nodes = new Map<string, { id: string; position: ConstructionPosition }>();
    const edgeBuilder = createBoundaryEdges(ctx.tableId, { kind: "private-when-full", runPrefix: operationId, existingUses: boundaryUsage(ctx) });
    function nodeAt(point: readonly [number, number]): string {
      const existing = [...retained.values(), ...nodes.values()].find((node) => Math.abs(node.position.x - point[0]) < 1e-5 && Math.abs(node.position.z - point[1]) < 1e-5);
      const node = existing ?? { id: `${operationId}:node:${nodes.size}`, position: { x: point[0], y: params.elevation, z: point[1] } };
      nodes.set(node.id, node);
      return node.id;
    }
    const regions = shapes.map((shape, index) => {
      const loops = shape.map((ring) => {
        const ids = ring.map(nodeAt);
        return ids.map((id, i) => edgeBuilder.use(id, ids[(i + 1) % ids.length]!));
      });
      return { regionId: `${operationId}:face:${index}`, boundary: loops[0]!, holes: loops.slice(1), surfaceType: "platform", physical: true };
    });
    ctx.runtime.applyPatchReplacement({ operationId, sourceSurfaceKeys: sources.map((source) => source.surfaceKey), patch: { nodes: [...nodes.values()], edges: edgeBuilder.all(), regions } }, "local", operationId);
    ctx.history.record({ kind: "path-brush", operationId });
    ctx.reportFeedback({ tone: "success", message: `Plataforma: ${regions.length} face(s) na elevacao ${params.elevation}.` });
  } catch (error) { ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) }); }
}

export const platformContourTool: ConstructionTool<"platform-contour"> = {
  id: "platform-contour",
  defaultParams: () => DEFAULT_TOOL_PARAMS["platform-contour"],
  previewFor(gesture, params, ctx) {
    const points = [...draft(ctx, params), ...gesture.samples].map((sample) => ({ ...sample.point, y: params.elevation }));
    return polylineSegmentsPreview(points.length > 2 ? [...points, points[0]!] : points, 0x79b8e8);
  },
  onClick(ctx, sample, params) {
    const points = draft(ctx, params);
    const first = points[0];
    if (first && points.length >= 3 && Math.hypot(first.point.x - sample.point.x, first.point.z - sample.point.z) < 0.25) {
      commitPlatformContour(ctx, points, params); points.length = 0;
    } else {
      points.push(sample);
      ctx.reportFeedback({ tone: "info", message: "Marque os cantos e clique no primeiro para fechar, ou arraste um contorno livre." });
    }
  },
  onPointerUp(ctx, gesture, params) {
    const points = gesture.samples.filter((sample, i, array) => i === 0 || Math.hypot(sample.point.x - array[i - 1]!.point.x, sample.point.z - array[i - 1]!.point.z) > 0.05);
    if (points.length < 3) return;
    commitPlatformContour(ctx, points, params);
    draft(ctx, params).length = 0;
  },
};
