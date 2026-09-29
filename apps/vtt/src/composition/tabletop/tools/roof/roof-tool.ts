import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import {
  carriedOnto,
  DEFAULT_TOOL_PARAMS,
  hasTrait,
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
  type RoofSource,
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

/** How near a roof's corner or side a drawn corner lands on it. */
const MAGNET = 0.25;

type Polygon = readonly (readonly Point[])[];
/** Footprints as planar polygons: each one's rings closed, outline first. */
const polygonsOf = (footprints: readonly RoofFootprint[]): Polygon[] => footprints.map((footprint) => [footprint.outer, ...footprint.holes].map((ring) => [...ring, ring[0]!]));
/** Planar polygons as footprints: their rings opened again. */
const footprintsFrom = (polygons: readonly Polygon[]): RoofFootprint[] => polygons.map((polygon) => {
  const open = (ring: readonly Point[]) => ring.slice(0, -1);
  return { outer: open(polygon[0]!), holes: polygon.slice(1).map(open) };
});
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

/** The floors standing, with their outlines in plan -- what a roof is drawn onto. */
function floorsOf(ctx: ToolContext) {
  return ctx.runtime.getAllRegionTopologies().filter((face) => hasTrait(face.surfaceType, "floor") && face.outerLoops.length === 1);
}

/** Where a roof begun at `start` stands: on the node or the floor it was begun on, else at the tool's elevation. */
function startElevation(ctx: ToolContext, start: PointerSample, params: Params): number {
  const picked = start.nodeId ? ctx.runtime.getGraphSnapshot().nodes.find((node) => node.id === start.nodeId) : undefined;
  if (picked) return picked.position.y;
  const floor = start.surfaceRef ? floorsOf(ctx).find((face) => surfaceRefFromNodeSet(face.surfaceKey) === start.surfaceRef) : undefined;
  return floor?.nodes[0]?.position.y ?? params.elevation;
}

/** A drawn outline as plan corners, curved sides followed by short straight ones. */
function cornersOf(contour: readonly FittedEdge[]): Point[] {
  const points = outlineOf(contour).map((p) => [p.x, p.z] as const);
  return points.filter((p, i) => {
    const q = points[(i + 1) % points.length]!;
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6;
  });
}

/** Every ring of the standing roofs' footprints. */
const roofRings = (recipes: readonly RoofRecipe[]) => recipes.flatMap((recipe) => ringsOf(recipe.footprints).map((ring) => ring.points));

/** Every corner and every side of `rings`. */
function rimsOf(rings: readonly (readonly Point[])[]): { readonly corners: Point[]; readonly sides: (readonly [Point, Point])[] } {
  return {
    corners: rings.flat(),
    sides: rings.flatMap((ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length]!] as const)),
  };
}

/**
 * A drawn corner landed on a roof's or a floor's own corner when it comes
 * within reach of one, else on its side -- so what is drawn against a roof,
 * or over a floor, meets it exactly, never a sliver off it.
 */
function landed(outline: readonly Point[], rings: readonly (readonly Point[])[]): Point[] {
  const { corners, sides } = rimsOf(rings);
  return outline.map((p) => {
    const corner = corners.reduce<{ at?: Point; d: number }>((best, q) => {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      return d <= MAGNET && d < best.d ? { at: q, d } : best;
    }, { d: Infinity }).at;
    if (corner) return corner;
    return sides.reduce<{ at?: Point; d: number }>((best, [a, b]) => {
      const d2 = [b[0] - a[0], b[1] - a[1]] as const;
      const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * d2[0] + (p[1] - a[1]) * d2[1]) / (d2[0] * d2[0] + d2[1] * d2[1] || 1)));
      const at: Point = [a[0] + d2[0] * t, a[1] + d2[1] * t];
      const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
      return d <= MAGNET && d < best.d ? { at, d } : best;
    }, { d: Infinity }).at ?? p;
  });
}

/** Whether a drawn outline meets a roof: they overlap, share a side, or touch at a corner. */
function meets(ctx: ToolContext, outline: readonly Point[], recipe: RoofRecipe): boolean {
  const mine = polygonsOf([{ outer: outline, holes: [] }]);
  const theirs = polygonsOf(recipe.footprints);
  if (planarUnion(ctx.runtime, mine, theirs).length < mine.length + theirs.length) return true;
  const { corners, sides } = rimsOf(roofRings([recipe]));
  const touches = (p: Point, list: readonly Point[], rims: readonly (readonly [Point, Point])[]) =>
    list.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6)
    || rims.some(([a, b]) => {
      const d = [b[0] - a[0], b[1] - a[1]] as const;
      const t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1);
      return t >= 0 && t <= 1 && Math.hypot(p[0] - (a[0] + d[0] * t), p[1] - (a[1] + d[1] * t)) < 1e-6;
    });
  const own = rimsOf([outline]);
  return outline.some((p) => touches(p, corners, sides)) || corners.some((p) => touches(p, own.corners, own.sides));
}

/**
 * What an outline drawn on `level` makes: drawn, a roof of its own -- or,
 * where it meets roofs already standing, along a side or at a corner, those
 * roofs and it fused into one, every side they had keeping its slope; cut,
 * what is left of each roof it takes a piece of, as many roofs as pieces.
 */
function stroked(ctx: ToolContext, contour: readonly FittedEdge[], level: number, params: Params): { readonly requests: readonly RoofSource[]; readonly replaces: readonly ConstructionSurfaceKey[] } {
  const roofs = [...roofsOf(ctx).values()];
  const topologies = ctx.runtime.getAllRegionTopologies();
  const floors = floorsOf(ctx).flatMap((face) => {
    try {
      return [roofBaseAt(topologies, { point: { x: 0, y: 0, z: 0 }, surfaceRef: surfaceRefFromNodeSet(face.surfaceKey) })];
    } catch {
      return [];
    }
  });
  const outline = params.action === "hole" ? cornersOf(contour) : landed(cornersOf(contour), [...roofRings(roofs.map(({ recipe }) => recipe)), ...floors.map((floor) => floor.footprint.outer)]);
  // Drawn round a floor's own outline, the roof stands on that floor: at its height, and following it.
  const same = (a: readonly Point[], b: readonly Point[]) => a.length === b.length && a.every((p) => b.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6));
  const on = floors.find((floor) => same(outline, floor.footprint.outer));
  const drawn: RoofSource = on
    ? { ...roofOver([on.footprint], on.elevation, params.height, params.waters), base: on.ref }
    : roofOver([{ outer: outline, holes: [] }], level, params.height, params.waters);
  if (params.action === "hole") {
    const area = polygonsOf(drawn.footprints);
    const cut = roofs.filter(({ recipe }) => areaOf(planarDifference(ctx.runtime, polygonsOf(recipe.footprints), area)) < areaOf(polygonsOf(recipe.footprints)) - 1e-6);
    if (cut.length === 0) throw new Error("O buraco não passa por nenhum telhado.");
    return {
      requests: cut.map(({ recipe }) => {
        const { group: _group, ...source } = recipe;
        return { ...source, cutouts: [...(recipe.cutouts ?? []), { outer: outline, holes: [] }] };
      }),
      replaces: cut.flatMap(({ faces }) => faces),
    };
  }
  if (params.action === "cut") {
    const cut = roofs.flatMap(({ recipe, faces }) => {
      const whole = polygonsOf(recipe.footprints);
      const left = planarDifference(ctx.runtime, whole, polygonsOf(drawn.footprints));
      return areaOf(left) < areaOf(whole) - 1e-6 ? [{ recipe, faces, left }] : [];
    });
    if (cut.length === 0) throw new Error("O recorte não passa por nenhum telhado.");
    const requests = cut.flatMap(({ recipe, left }) => left.map((piece) => {
      const footprints = footprintsFrom([piece]);
      return { elevation: recipe.elevation, height: recipe.height, ...carriedOnto(footprints, [recipe]) };
    }));
    return { requests, replaces: cut.flatMap(({ faces }) => faces) };
  }
  const fused = roofs.filter(({ recipe }) => meets(ctx, outline, recipe));
  if (fused.length === 0) return { requests: [drawn], replaces: [] };
  // Their union: one piece where they overlap or share a side, pieces joined at a corner where they only touch there.
  const area = planarUnion(ctx.runtime, polygonsOf(drawn.footprints), ...fused.map(({ recipe }) => polygonsOf(recipe.footprints)));
  const first = fused[0]!.recipe;
  return {
    requests: [{
      elevation: first.elevation, height: Math.max(...fused.map(({ recipe }) => recipe.height)),
      ...carriedOnto(footprintsFrom(area), fused.map(({ recipe }) => recipe), { outline, slopes: drawn.slopes }),
    }],
    replaces: fused.flatMap(({ faces }) => faces),
  };
}

/** Commits the roofs `requests` make in place of the faces `replaces` names, each keeping its recipe on every face it made. */
export function commitRoofRecipes(ctx: ToolContext, requests: readonly RoofSource[], replaces: readonly ConstructionSurfaceKey[] = [], done = "Telhado criado."): void {
  try {
    const operationId = scopedToolId(ctx, "roof", ctx.nextSequence());
    const standing = ctx.runtime.getAllRegionTopologies();
    const made = requests.map((request, i) => roofGraphPatch(ctx.runtime, request, requests.length === 1 ? operationId : `${operationId}:${i}`, standing));
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
  const { group: _group, ...request } = recipe;
  const group = recipe.group;
  commitRoofRecipes(ctx, [{ ...request, dormers: [...(recipe.dormers ?? []), dormer] }], roofsOf(ctx).get(group)!.faces, "Lucarna criada.");
}

const stroke = contourStroke<"roof", Params>({
  color: COLOR,
  levelAt: (ctx, first, params) => startElevation(ctx, first, params),
  commit: (ctx, contour, level, params) => {
    try {
      const { requests, replaces } = stroked(ctx, contour, level, params);
      commitRoofRecipes(ctx, requests, replaces, params.action === "hole" ? "Buraco aberto no telhado." : params.action === "cut" ? "Telhado recortado." : replaces.length > 0 ? "Telhados fundidos." : "Telhado criado.");
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
    }
  },
  // What a drawn outline makes, fused with whatever it meets.
  previewClosed: (ctx, outline, level, params) => {
    if (params.action !== "draw" && params.action !== "hole") return undefined;
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

const drawing = (params: Params) => params.action === "draw" || params.action === "cut" || params.action === "hole";

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
        commitRoofRecipes(ctx, [{ ...roofOver([base.footprint], base.elevation, params.height, params.waters), base: base.ref }]);
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
