import { DEFAULT_TOOL_PARAMS, ROOF_OVERHANG, roofGraphPatch, roofOver, roofStructureType, type ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import type { CapRequest } from "@/ports";
import type { RoofRequest } from "../../../../ports/cap-port.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { roofBaseAt } from "./roof-base.ts";
import { keepFaceProps } from "../core/face-props.ts";

type Params = ToolParamsByTool["roof"];
type Point = readonly [number, number];

function coneRequest(center: Point, radius: number, elevation: number, params: Params): CapRequest {
  return { base: { kind: "circle", center, radius }, elevation, height: params.height, overhang: ROOF_OVERHANG, curvatures: params.curvatures };
}

function startElevation(ctx: ToolContext, start: PointerSample, params: Params): number {
  const picked = start.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((node) => node.id === start.nodeId) : undefined;
  return picked?.position.y ?? params.elevation;
}

function dragged(ctx: ToolContext, start: PointerSample, end: PointerSample, params: Params): RoofRequest {
  const [x0, x1] = [Math.min(start.point.x, end.point.x), Math.max(start.point.x, end.point.x)];
  const [z0, z1] = [Math.min(start.point.z, end.point.z), Math.max(start.point.z, end.point.z)];
  return roofOver([[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]], startElevation(ctx, start, params), params.height, params.waters);
}

/** Commits a roof generated from `request`, keeping the recipe on every face it made. */
export function commitRoofRecipe(ctx: ToolContext, request: RoofRequest): void {
  try {
    const operationId = scopedToolId(ctx, "roof", ctx.nextSequence());
    const { patch, faceProps } = roofGraphPatch(ctx.runtime, request, operationId);
    const { recorded } = commitPatchReplacement(ctx.runtime, { operationId, sourceSurfaceKeys: [], patch }, {
      transactionId: operationId,
      afterward: (outcome) => keepFaceProps(ctx.runtime, outcome.createdSurfaceKeys, faceProps),
    });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    ctx.reportFeedback({ tone: "success", message: "Telhado criado." });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

/** Assigns identities to a native cone and applies it atomically. */
export function commitRoof(ctx: ToolContext, capRequest: CapRequest): void {
  try {
    const cap = ctx.runtime.generateCap(capRequest);
    const operationId = scopedToolId(ctx, "roof", ctx.nextSequence());
    const nodeId = (index: number) => `${operationId}:node:${index}`;
    const edgeId = (index: number) => `${operationId}:edge:${index}`;
    const { recorded } = commitPatchReplacement(ctx.runtime, {
      operationId, sourceSurfaceKeys: [],
      patch: {
        nodes: cap.nodes.map(([x,y,z], index) => ({ id: nodeId(index), position: { x,y,z } })),
        edges: cap.edges.map((edge,index) => ({ edgeId: edgeId(index), startNodeId: nodeId(edge.start), endNodeId: nodeId(edge.end),
          geometry: edge.center ? { kind: "arc" as const, center: edge.center, clockwise: false } : { kind: "line" as const } })),
        regions: cap.faces.map((face,index) => ({ regionId: `${operationId}:face:${index}`, surfaceType: "roof", physical: true,
          profile: face.profile, boundary: face.boundary.map(([edge,reversed]) => ({ edgeId: edgeId(edge), reversed })) })),
      },
    }, { transactionId: operationId });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    ctx.reportFeedback({ tone: "success", message: "Telhado criado." });
  } catch (error) {
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

const rawRoofTool: ConstructionTool<"roof"> = {
  id: "roof", previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS.roof,
  previewFor(gesture, params, ctx) {
    if (params.shape === "base") return undefined;
    try {
      const preview = params.shape === "circle"
        ? ctx.runtime.generateCap(coneRequest([gesture.current.point.x, gesture.current.point.z], params.radius, startElevation(ctx, gesture.start, params), params)).preview
        : ctx.runtime.generateRoof(dragged(ctx, gesture.start, gesture.current, params)).preview;
      return segmentsPreview(Float32Array.from(preview.flat()), 0xb96e48);
    } catch { return undefined; }
  },
  onClick(ctx, sample, params) {
    if (params.shape === "base") {
      try {
        const base = roofBaseAt(ctx.runtime.getAllRegionTopologies(), sample);
        if (base.kind === "circle") commitRoof(ctx, coneRequest(base.center, base.radius, base.elevation, params));
        else commitRoofRecipe(ctx, roofOver(ctx.runtime.roofFootprintBlocks(base.contour), base.elevation, params.height, params.waters));
      } catch (error) { ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    if (params.shape === "circle") commitRoof(ctx, coneRequest([sample.point.x, sample.point.z], params.radius, startElevation(ctx, sample, params), params));
    else ctx.reportFeedback({ tone: "info", message: "Arraste entre dois cantos para criar o telhado." });
  },
  onPointerUp(ctx, gesture, params) {
    if (params.shape !== "rectangle" || gesture.samples.length < 2) return;
    commitRoofRecipe(ctx, dragged(ctx, gesture.start, gesture.current, params));
  },
};

/** Also edits an existing roof, through its handles only -- see `structure-edit-behavior.ts` and `roof-recipe.ts`. */
export const roofTool = withStructureEditing(rawRoofTool, { ownsType: (surfaceType) => surfaceType === roofStructureType.surfaceType, handlesOnly: true });
