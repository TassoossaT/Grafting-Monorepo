import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { DEFAULT_TOOL_PARAMS, type ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import type { CapRequest } from "@/ports";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";

/** Application-wide overhang; no individual roof/band control in this delivery. */
export const ROOF_OVERHANG = 0.2;
type Params = ToolParamsByTool["roof"];

function request(ctx: ToolContext, start: PointerSample, end: PointerSample, params: Params): CapRequest {
  const picked = start.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((node) => node.id === start.nodeId) : undefined;
  return {
    base: params.shape === "circle"
      ? { kind: "circle", center: [end.point.x, end.point.z], radius: params.radius }
      : { kind: "rectangle", min: [Math.min(start.point.x, end.point.x), Math.min(start.point.z, end.point.z)], max: [Math.max(start.point.x, end.point.x), Math.max(start.point.z, end.point.z)] },
    elevation: picked?.position.y ?? params.elevation,
    height: params.height,
    overhang: ROOF_OVERHANG,
    curvatures: params.curvatures,
  };
}

/** Assigns identities to native geometry and applies the entire covering atomically. */
export function commitRoof(ctx: ToolContext, capRequest: CapRequest): void {
  try {
    const cap = ctx.runtime.generateCap(capRequest);
    const operationId = scopedToolId(ctx, "roof", ctx.nextSequence());
    const nodeId = (index: number) => `${operationId}:node:${index}`;
    const edgeId = (index: number) => `${operationId}:edge:${index}`;
    ctx.runtime.applyPatchReplacement({
      operationId, sourceSurfaceKeys: [],
      patch: {
        nodes: cap.nodes.map(([x,y,z], index) => ({ id: nodeId(index), position: { x,y,z } })),
        edges: cap.edges.map((edge,index) => ({ edgeId: edgeId(index), startNodeId: nodeId(edge.start), endNodeId: nodeId(edge.end),
          geometry: edge.center ? { kind: "arc" as const, center: edge.center, clockwise: false } : { kind: "line" as const } })),
        regions: cap.faces.map((face,index) => ({ regionId: `${operationId}:face:${index}`, surfaceType: "roof", physical: true,
          profile: face.profile, boundary: face.boundary.map(([edge,reversed]) => ({ edgeId: edgeId(edge), reversed })) })),
      },
    }, "local", operationId);
    ctx.history.record({ kind: "path-brush", operationId });
    ctx.reportFeedback({ tone: "success", message: "Telhado criado com quatro folhas." });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

export const roofTool: ConstructionTool<"roof"> = {
  id: "roof", previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS.roof,
  previewFor(gesture, params, ctx) {
    if (params.shape === "platform") return undefined;
    try {
      const cap = ctx.runtime.generateCap(request(ctx, gesture.start, gesture.current, params));
      return segmentsPreview(Float32Array.from(cap.preview.flat()), 0xb96e48);
    } catch { return undefined; }
  },
  onClick(ctx, sample, params) {
    if (params.shape === "platform") {
      try {
        const source = ctx.runtime.getAllRegionTopologies().find((face) => face.surfaceType === "platform" && (
          sample.surfaceRef ? surfaceRefFromNodeSet(face.surfaceKey) === sample.surfaceRef : sample.nodeId && face.nodes.some((node) => node.id === sample.nodeId)));
        if (!source || source.outerLoops.length !== 1 || source.holes.length || source.outerLoops[0]!.length !== 4) {
          throw new Error("Selecione uma plataforma retangular ou circular, sem aberturas.");
        }
        const boundary = source.outerLoops[0]!;
        if (!source.nodes.every((node) => node.position.y === source.nodes[0]!.position.y)) {
          throw new Error("A base do telhado precisa estar no mesmo nível.");
        }
        const point = (index: number): readonly [number, number] => {
          const node = source.nodes.find((node) => node.id === boundary[index]!.startNodeId);
          if (!node) throw new Error("A plataforma contém um contorno incompleto.");
          return [node.position.x, node.position.z];
        };
        const center = (index: number) => { const geometry = boundary[index]!.geometry; return geometry.kind === "arc" ? geometry.center : null; };
        commitRoof(ctx, { base: { kind: "contour", points: [point(0), point(1), point(2), point(3)], centers: [center(0), center(1), center(2), center(3)] },
          elevation: source.nodes[0]!.position.y, height: params.height, overhang: ROOF_OVERHANG, curvatures: params.curvatures });
      } catch (error) { ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (params.shape === "circle") commitRoof(ctx, request(ctx, sample, sample, params));
    else ctx.reportFeedback({ tone: "info", message: "Arraste entre dois cantos para criar o telhado." });
  },
  onPointerUp(ctx, gesture, params) {
    if (params.shape !== "rectangle" || gesture.samples.length < 2) return;
    commitRoof(ctx, request(ctx, gesture.start, gesture.current, params));
  },
};
