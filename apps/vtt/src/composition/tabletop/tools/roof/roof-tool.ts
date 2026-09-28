import { DEFAULT_TOOL_PARAMS, dormerAt, ROOF_FACE_PROP, ROOF_OVERHANG, ROOF_RECIPE_PROP, roofGraphPatch, roofOver, roofStructureType, type RoofFaceRole, type RoofRecipe, type ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { CapRequest, ConstructionSurfaceKey } from "@/ports";
import type { RoofRequest } from "../../../../ports/cap-port.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { roofBaseAt } from "./roof-base.ts";
import { keepFaceProps, pinnedToRoles } from "../core/face-props.ts";

type Params = ToolParamsByTool["roof"];
type Point = readonly [number, number];

function coneRequest(center: Point, radius: number, elevation: number, params: Params): CapRequest {
  return { base: { kind: "circle", center, radius }, elevation, height: params.height, overhang: ROOF_OVERHANG, curvatures: params.curvatures };
}

function startElevation(ctx: ToolContext, start: PointerSample, params: Params): number {
  const picked = start.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((node) => node.id === start.nodeId) : undefined;
  return picked?.position.y ?? params.elevation;
}

/** Whether two convex outlines overlap or touch: no side of either separates them. */
function meets(a: readonly Point[], b: readonly Point[]): boolean {
  return ![a, b].some((outline) => outline.some((p, i) => {
    const q = outline[(i + 1) % outline.length]!;
    const axis = [q[1] - p[1], p[0] - q[0]] as const;
    const span = (points: readonly Point[]) => points.map((x) => x[0] * axis[0] + x[1] * axis[1]);
    const [sa, sb] = [span(a), span(b)];
    const gap = Math.max(Math.min(...sb) - Math.max(...sa), Math.min(...sa) - Math.max(...sb));
    return gap > 1e-6 * Math.hypot(axis[0], axis[1]);
  }));
}

/**
 * What a rectangle drawn from `start` to `end` makes: a roof of its own, or
 * -- reaching into a roof already standing -- that roof with the rectangle
 * joined to it as one more block, its faces to replace.
 */
function dragged(ctx: ToolContext, start: PointerSample, end: PointerSample, params: Params): { readonly request: RoofRequest; readonly replaces: readonly ConstructionSurfaceKey[] } {
  const [x0, x1] = [Math.min(start.point.x, end.point.x), Math.max(start.point.x, end.point.x)];
  const [z0, z1] = [Math.min(start.point.z, end.point.z), Math.max(start.point.z, end.point.z)];
  const outline: Point[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const faces = ctx.runtime.getAllRegionTopologies().filter((face) => face.props?.[ROOF_RECIPE_PROP] !== undefined);
  const joined = faces.map((face) => face.props![ROOF_RECIPE_PROP] as RoofRecipe).find((recipe) => recipe.blocks.some((block) => meets(block.contour, outline)));
  if (!joined) return { request: roofOver([outline], startElevation(ctx, start, params), params.height, params.waters), replaces: [] };
  const arm = roofOver([outline], joined.elevation, joined.height, params.waters).blocks[0]!;
  return {
    request: { elevation: joined.elevation, height: joined.height, blocks: [...joined.blocks, arm], dormers: joined.dormers ?? [] },
    replaces: faces.filter((face) => (face.props![ROOF_RECIPE_PROP] as RoofRecipe).group === joined.group).map((face) => face.surfaceKey),
  };
}

/** Commits a roof generated from `request` in place of the faces `replaces` names, keeping the recipe on every face it made. */
export function commitRoofRecipe(ctx: ToolContext, request: RoofRequest, replaces: readonly ConstructionSurfaceKey[] = []): void {
  try {
    const operationId = scopedToolId(ctx, "roof", ctx.nextSequence());
    const { patch, faceProps } = roofGraphPatch(ctx.runtime, request, operationId);
    const pinned = pinnedToRoles(ctx.runtime.getAllRegionTopologies(), replaces);
    const { recorded } = commitPatchReplacement(ctx.runtime, { operationId, sourceSurfaceKeys: replaces, patch }, {
      transactionId: operationId,
      afterward: (outcome) => keepFaceProps(ctx.runtime, operationId, outcome.createdSurfaceKeys, faceProps, pinned),
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

/** A dormer set on the roof leaf under `sample`, its front's middle where the click landed. */
function addDormer(ctx: ToolContext, sample: PointerSample, params: Params): void {
  const faces = ctx.runtime.getAllRegionTopologies();
  const leaf = faces.find((face) => sample.surfaceRef !== undefined && surfaceRefFromNodeSet(face.surfaceKey) === sample.surfaceRef);
  const recipe = leaf?.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined;
  const role = leaf?.props?.[ROOF_FACE_PROP] as RoofFaceRole | undefined;
  if (!recipe || !role || role.upright || role.block >= recipe.blocks.length) {
    ctx.reportFeedback({ tone: "error", message: "Clique numa água do telhado para pôr a lucarna." });
    return;
  }
  const dormer = dormerAt(recipe, role.block, role.side, [sample.point.x, sample.point.z], params.dormerWidth, params.dormerFront, params.waters);
  const { group, ...request } = recipe;
  commitRoofRecipe(ctx, { ...request, dormers: [...(recipe.dormers ?? []), dormer] },
    faces.filter((face) => (face.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined)?.group === group).map((face) => face.surfaceKey));
}

const rawRoofTool: ConstructionTool<"roof"> = {
  id: "roof", previewOnHover: true,
  defaultParams: () => DEFAULT_TOOL_PARAMS.roof,
  previewFor(gesture, params, ctx) {
    if (params.shape === "base" || params.shape === "dormer") return undefined;
    try {
      const preview = params.shape === "circle"
        ? ctx.runtime.generateCap(coneRequest([gesture.current.point.x, gesture.current.point.z], params.radius, startElevation(ctx, gesture.start, params), params)).preview
        : ctx.runtime.generateRoof(dragged(ctx, gesture.start, gesture.current, params).request).preview;
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
    if (params.shape === "dormer") addDormer(ctx, sample, params);
    else if (params.shape === "circle") commitRoof(ctx, coneRequest([sample.point.x, sample.point.z], params.radius, startElevation(ctx, sample, params), params));
    else ctx.reportFeedback({ tone: "info", message: "Arraste entre dois cantos para criar o telhado." });
  },
  onPointerUp(ctx, gesture, params) {
    if (params.shape !== "rectangle" || gesture.samples.length < 2) return;
    const { request, replaces } = dragged(ctx, gesture.start, gesture.current, params);
    commitRoofRecipe(ctx, request, replaces);
  },
};

/** Also edits an existing roof, through its handles only -- see `structure-edit-behavior.ts` and `roof-recipe.ts`. */
export const roofTool = withStructureEditing(rawRoofTool, { ownsType: (surfaceType) => surfaceType === roofStructureType.surfaceType, handlesOnly: true });
