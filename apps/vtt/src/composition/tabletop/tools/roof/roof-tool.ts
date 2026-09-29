import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import {
  carriedOnto,
  DEFAULT_TOOL_PARAMS,
  dormerAt,
  outlineOf,
  planarDifference,
  planarUnion,
  ringsOf,
  ROOF_FACE_PROP,
  ROOF_RECIPE_PROP,
  roofGraphPatch,
  roofOver,
  roofStructureType,
  type FittedEdge,
  type RoofFaceRole,
  type RoofRecipe,
  type ToolParamsByTool,
} from "../../../../features/edit-construction/index.ts";
import type { ConstructionPatch, ConstructionSurfaceKey } from "@/ports";
import type { RoofFootprint, RoofRequest } from "../../../../ports/cap-port.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext } from "../core/tool-context.ts";
import { withStructureEditing } from "../core/structure-edit-behavior.ts";
import { contourStroke } from "../core/contour-stroke.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { commitPatchReplacement } from "../../effects/effect-commit.ts";
import { roofBaseAt } from "./roof-base.ts";
import { keepFaceProps, pinnedToRoles } from "../core/face-props.ts";

type Params = ToolParamsByTool["roof"];
type Point = readonly [number, number];
const COLOR = 0xb96e48;

/** A footprint as a planar polygon: its rings closed, outline first. */
const polygonOf = (footprint: RoofFootprint) => ringsOf(footprint).map((ring) => [...ring, ring[0]!]);
/** A planar polygon as a footprint: its rings opened again. */
const footprintOf = (polygon: readonly (readonly Point[])[]): RoofFootprint => {
  const open = (ring: readonly Point[]) => ring.slice(0, -1);
  return { outer: open(polygon[0]!), holes: polygon.slice(1).map(open) };
};
/** How much ground planar polygons cover: outlines less holes. */
const areaOf = (polygons: readonly (readonly (readonly Point[])[])[]) => polygons.reduce((sum, polygon) => sum + polygon.reduce((own, ring, r) => {
  const signed = Math.abs(ring.reduce((s, a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    return s + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2);
  return own + (r === 0 ? signed : -signed);
}, 0), 0);

/** The roofs standing, each by its group: its recipe and its faces. */
function roofsOf(ctx: ToolContext): Map<string, { readonly recipe: RoofRecipe; readonly faces: ConstructionSurfaceKey[] }> {
  const roofs = new Map<string, { recipe: RoofRecipe; faces: ConstructionSurfaceKey[] }>();
  for (const face of ctx.runtime.getAllRegionTopologies()) {
    const recipe = face.props?.[ROOF_RECIPE_PROP] as RoofRecipe | undefined;
    if (!recipe) continue;
    const known = roofs.get(recipe.group) ?? { recipe, faces: [] };
    known.faces.push(face.surfaceKey);
    roofs.set(recipe.group, known);
  }
  return roofs;
}

function startElevation(ctx: ToolContext, start: PointerSample, params: Params): number {
  const picked = start.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((node) => node.id === start.nodeId) : undefined;
  return picked?.position.y ?? params.elevation;
}

/** A drawn outline as plan corners, curved sides followed by short straight ones. */
function cornersOf(contour: readonly FittedEdge[]): Point[] {
  const points = outlineOf(contour).map((p) => [p.x, p.z] as const);
  return points.filter((p, i) => {
    const q = points[(i + 1) % points.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
}

/**
 * What an outline drawn on `level` makes: drawn, a roof of its own -- or,
 * where it meets roofs already standing, those roofs and it fused into one
 * footprint, every side they had keeping its slope; cut, what is left of
 * each roof it takes a piece of, as many roofs as pieces.
 */
function stroked(ctx: ToolContext, contour: readonly FittedEdge[], level: number, params: Params): { readonly requests: readonly RoofRequest[]; readonly replaces: readonly ConstructionSurfaceKey[] } {
  const outline = cornersOf(contour);
  const drawn = roofOver({ outer: outline, holes: [] }, level, params.height, params.waters);
  const roofs = [...roofsOf(ctx).values()];
  if (params.action === "cut") {
    const cut = roofs.flatMap(({ recipe, faces }) => {
      const whole = polygonOf(recipe.footprint);
      const left = planarDifference(ctx.runtime, whole, polygonOf(drawn.footprint));
      return areaOf(left) < areaOf([whole]) - 1e-6 ? [{ recipe, faces, left }] : [];
    });
    if (cut.length === 0) throw new Error("O recorte não passa por nenhum telhado.");
    const requests = cut.flatMap(({ recipe, left }) => left.map((piece) => {
      const footprint = footprintOf(piece);
      return { elevation: recipe.elevation, height: recipe.height, footprint, ...carriedOnto(footprint, [recipe]) };
    }));
    return { requests, replaces: cut.flatMap(({ faces }) => faces) };
  }
  // Touching or overlapping, their union is one piece.
  const fused = roofs.filter(({ recipe }) => planarUnion(ctx.runtime, polygonOf(drawn.footprint), polygonOf(recipe.footprint)).length === 1);
  if (fused.length === 0) return { requests: [drawn], replaces: [] };
  const [area] = planarUnion(ctx.runtime, polygonOf(drawn.footprint), ...fused.map(({ recipe }) => polygonOf(recipe.footprint)));
  const footprint = footprintOf(area!);
  const first = fused[0]!.recipe;
  return {
    requests: [{
      elevation: first.elevation, height: Math.max(...fused.map(({ recipe }) => recipe.height)), footprint,
      ...carriedOnto(footprint, fused.map(({ recipe }) => recipe), { outline, slopes: drawn.slopes }),
    }],
    replaces: fused.flatMap(({ faces }) => faces),
  };
}

/** Commits the roofs `requests` make in place of the faces `replaces` names, each keeping its recipe on every face it made. */
export function commitRoofRecipes(ctx: ToolContext, requests: readonly RoofRequest[], replaces: readonly ConstructionSurfaceKey[] = [], done = "Telhado criado."): void {
  try {
    const operationId = scopedToolId(ctx, "roof", ctx.nextSequence());
    const made = requests.map((request, i) => roofGraphPatch(ctx.runtime, request, requests.length === 1 ? operationId : `${operationId}:${i}`));
    const patch: ConstructionPatch = {
      nodes: made.flatMap(({ patch }) => patch.nodes),
      edges: made.flatMap(({ patch }) => patch.edges),
      regions: made.flatMap(({ patch }) => patch.regions),
    };
    const faceProps = new Map(made.flatMap(({ faceProps }) => [...faceProps]));
    const pinned = pinnedToRoles(ctx.runtime.getAllRegionTopologies(), replaces);
    const { recorded } = commitPatchReplacement(ctx.runtime, { operationId, sourceSurfaceKeys: replaces, patch }, {
      transactionId: operationId,
      afterward: (outcome) => keepFaceProps(ctx.runtime, operationId, outcome.createdSurfaceKeys, faceProps, pinned),
    });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    ctx.reportFeedback({ tone: "success", message: done });
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
  if (!recipe || !role || role.upright || role.dormer !== undefined || role.side >= recipe.slopes.length) {
    ctx.reportFeedback({ tone: "error", message: "Clique numa água do telhado para pôr a lucarna." });
    return;
  }
  const dormer = dormerAt(recipe, role.side, [sample.point.x, sample.point.z], params.dormerWidth, params.dormerFront, params.waters);
  const { group, ...request } = recipe;
  commitRoofRecipes(ctx, [{ ...request, dormers: [...(recipe.dormers ?? []), dormer] }], roofsOf(ctx).get(group)!.faces, "Lucarna criada.");
}

const stroke = contourStroke<"roof", Params>({
  color: COLOR,
  levelAt: (ctx, first, params) => startElevation(ctx, first, params),
  commit: (ctx, contour, level, params) => {
    try {
      const { requests, replaces } = stroked(ctx, contour, level, params);
      commitRoofRecipes(ctx, requests, replaces, params.action === "cut" ? "Telhado recortado." : replaces.length > 0 ? "Telhados fundidos." : "Telhado criado.");
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  },
  // What a drawn outline makes, fused with whatever it meets.
  previewClosed: (ctx, outline, level, params) => {
    if (params.action !== "draw") return undefined;
    try {
      const contour = outline.map((start, i) => ({ start, end: outline[(i + 1) % outline.length]!, geometry: { kind: "line" as const } }));
      const { requests } = stroked(ctx, contour, level, params);
      return segmentsPreview(Float32Array.from(requests.flatMap((request) => ctx.runtime.generateRoof(request).preview.flat())), COLOR);
    } catch {
      return undefined;
    }
  },
  dragHint: (shape) => (shape === "rectangle" ? "Arraste de um canto ao canto oposto. Encostando num telhado, os dois viram um só." : "Arraste um contorno fechado."),
});

const drawing = (params: Params) => params.action === "draw" || params.action === "cut";

const rawRoofTool: ConstructionTool<"roof"> = {
  id: "roof",
  previewOnHover: true,
  // Squared in the frame each shape is built in, never to the world's fixed grid.
  useGridSnap: false,
  defaultParams: () => DEFAULT_TOOL_PARAMS.roof,
  onCancel: stroke.onCancel,
  previewFor(gesture, params, ctx) {
    return drawing(params) ? stroke.previewFor!(gesture, params, ctx) : undefined;
  },
  onClick(ctx, sample, params) {
    if (params.action === "dormer") return addDormer(ctx, sample, params);
    if (params.action === "base") {
      try {
        const base = roofBaseAt(ctx.runtime.getAllRegionTopologies(), sample);
        commitRoofRecipes(ctx, [roofOver(base.footprint, base.elevation, params.height, params.waters)]);
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    stroke.onClick!(ctx, sample, params);
  },
  onPointerUp(ctx, gesture, params) {
    if (drawing(params)) stroke.onPointerUp!(ctx, gesture, params);
  },
};

/** Also edits an existing roof, through its handles only -- see `structure-edit-behavior.ts` and `roof-recipe.ts`. */
export const roofTool = withStructureEditing(rawRoofTool, { ownsType: (surfaceType) => surfaceType === roofStructureType.surfaceType, handlesOnly: true });
