import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait, roofStructureType, type ToolParamsByTool } from "../../../../features/edit-construction/index.ts";
import type { CapRequest } from "@/ports";
import type { RoofRequest } from "../../../../ports/cap-port.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";

/** How far every eave reaches past its footprint when a roof is made. */
export const ROOF_OVERHANG = 0.2;
type Params = ToolParamsByTool["roof"];
type Point = readonly [number, number];

/** Region property carrying the roof's recipe, which every edit regenerates the roof from. */
export const ROOF_RECIPE_PROP = "roof";

/**
 * Which sides of a footprint rise, for a number of waters: every side; the
 * longest side and the one facing it most squarely; or the longest alone.
 * The rest are gables.
 */
export function presetSlopes(contour: readonly Point[], waters: Params["waters"]): number[] {
  const sides = contour.map((a, i) => {
    const b = contour[(i + 1) % contour.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return { length, direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length] as const };
  });
  if (waters === 4) return sides.map(() => 1);
  const longest = sides.reduce((best, side, i) => (side.length > sides[best]!.length ? i : best), 0);
  const along = (i: number) => sides[i]!.direction[0] * sides[longest]!.direction[0] + sides[i]!.direction[1] * sides[longest]!.direction[1];
  const facing = waters === 2
    ? sides.reduce((best, _, i) => (i !== longest && along(i) < along(best) ? i : best), longest === 0 ? 1 : 0)
    : longest;
  return sides.map((_, i) => (i === longest || i === facing ? 1 : 0));
}

/** A one-block roof over a convex footprint, shaped by the tool's waters. */
export function roofOver(contour: readonly Point[], elevation: number, params: Params): RoofRequest {
  return {
    elevation, height: params.height,
    blocks: [{ contour, slopes: presetSlopes(contour, params.waters), overhangs: contour.map(() => ROOF_OVERHANG) }],
  };
}

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
  return roofOver([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], startElevation(ctx, start, params), params);
}

/** Commits a roof generated from `request`, keeping the recipe on every face it made. */
export function commitRoofRecipe(ctx: ToolContext, request: RoofRequest): void {
  try {
    const roof = ctx.runtime.generateRoof(request);
    const operationId = scopedToolId(ctx, "roof", ctx.nextSequence());
    const nodeId = (index: number) => `${operationId}:node:${index}`;
    const edgeId = (index: number) => `${operationId}:edge:${index}`;
    const uses = (loop: readonly (readonly [number, boolean])[]) => loop.map(([edge, reversed]) => ({ edgeId: edgeId(edge), reversed }));
    const { recorded } = commitPatchReplacement(ctx.runtime, {
      operationId, sourceSurfaceKeys: [],
      patch: {
        nodes: roof.nodes.map(([x, y, z], index) => ({ id: nodeId(index), position: { x, y, z } })),
        edges: roof.edges.map((edge, index) => ({ edgeId: edgeId(index), startNodeId: nodeId(edge.start), endNodeId: nodeId(edge.end) })),
        regions: roof.faces.map((face, index) => ({
          regionId: `${operationId}:face:${index}`, surfaceType: "roof", physical: true,
          boundary: uses(face.boundary), ...(face.holes.length > 0 ? { holes: face.holes.map(uses) } : {}),
        })),
      },
    }, {
      transactionId: operationId,
      afterward: (outcome) => { ctx.runtime.setRegionProps(outcome.createdSurfaceKeys, { [ROOF_RECIPE_PROP]: { ...request, group: operationId } }); },
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
    if (params.shape === "platform") return undefined;
    try {
      const preview = params.shape === "circle"
        ? ctx.runtime.generateCap(coneRequest([gesture.current.point.x, gesture.current.point.z], params.radius, startElevation(ctx, gesture.start, params), params)).preview
        : ctx.runtime.generateRoof(dragged(ctx, gesture.start, gesture.current, params)).preview;
      return segmentsPreview(Float32Array.from(preview.flat()), 0xb96e48);
    } catch { return undefined; }
  },
  onClick(ctx, sample, params) {
    if (params.shape === "platform") {
      try {
        const source = ctx.runtime.getAllRegionTopologies().find((face) => hasTrait(face.surfaceType, "floor") && (
          sample.surfaceRef ? surfaceRefFromNodeSet(face.surfaceKey) === sample.surfaceRef : sample.nodeId && face.nodes.some((node) => node.id === sample.nodeId)));
        if (!source || source.outerLoops.length !== 1 || source.holes.length) {
          throw new Error("Selecione uma plataforma sem aberturas.");
        }
        const boundary = source.outerLoops[0]!;
        if (!source.nodes.every((node) => node.position.y === source.nodes[0]!.position.y)) {
          throw new Error("A base do telhado precisa estar no mesmo nível.");
        }
        const elevation = source.nodes[0]!.position.y;
        const point = (nodeId: string): Point => {
          const node = source.nodes.find((node) => node.id === nodeId);
          if (!node) throw new Error("A plataforma contém um contorno incompleto.");
          return [node.position.x, node.position.z];
        };
        const centers = boundary.flatMap((use) => (use.geometry.kind === "arc" ? [use.geometry.center] : []));
        const center = centers[0];
        if (center === undefined) {
          commitRoofRecipe(ctx, roofOver(boundary.map((use) => point(use.startNodeId)), elevation, params));
        } else if (centers.length === boundary.length && centers.every((other) => other[0] === center[0] && other[1] === center[1])) {
          const rim = point(boundary[0]!.startNodeId);
          commitRoof(ctx, coneRequest(center, Math.hypot(rim[0] - center[0], rim[1] - center[1]), elevation, params));
        } else {
          throw new Error("O telhado cobre plataformas de lados retos ou circulares.");
        }
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

/** Also grabs and edits an existing roof's own vertex/edge/body -- see `structure-edit-behavior.ts`. */
export const roofTool = withStructureEditing(rawRoofTool, { ownsType: (surfaceType) => surfaceType === roofStructureType.surfaceType });
