/**
 * The construction-tool vocabulary every layer (widgets, composition) needs
 * to agree on: which tools exist, what each one's parameters look like, and
 * how a tool describes its own not-yet-committed preview. Pure data, no
 * pointer/render logic -- that lives in `composition/tabletop/tools/`
 * (the tool implementations) and `adapters/rendering/` (turning a
 * {@link PreviewDescriptor} into an actual scene item).
 */
export type ConstructionToolId =
  | "navigate"
  | "platform-contour"
  | "slope-ramp"
  | "slope-spiral"
  | "roof"
  | "path-brush"
  | "wall-brush"
  | "wall-line"
  | "tower-stamp"
  | "opening"
  | "terrain-sculpt";

export type BrushShapeKind = "circle" | "square" | "hexagon";

export interface BrushShapeParams {
  /** Convex footprint shared by terrain and path brushes. */
  readonly shape: BrushShapeKind;
  /** Circle/hexagon radius, or square half-size, in world units. */
  readonly radius: number;
  /** Rotation around world Y; ignored by circles. */
  readonly rotationDegrees: number;
}

export interface PathBrushParams extends BrushShapeParams {
  /** Freehand or through-point road authoring; pen is a legacy alias for points. */
  readonly creationMode?: "brush" | "points" | "pen";
  /** Constraint for editing an existing curve with this same tool. */
  readonly curveMode?: "automatic" | "aligned" | "mirrored" | "free";
  /** Product recipe; every variant still creates the single `path` surface type. */
  readonly pathKind: PathKind;
  /** Width of the flat traversable bed, in world units. */
  readonly bedWidth: number;
  /** Width of each optional raised shoulder, in world units. */
  readonly shoulderWidth: number;
  /** Non-negative shoulder elevation above the path bed. */
  readonly shoulderHeight: number;
  /** Maximum corner extension, in multiples of the local half width. */
  readonly miterLimit: number;
}

/**
 * Which preset a path run is built from.
 *
 * A subtype, not a type: every one of these collapses to the single `path`
 * surface type, shares its role table, its cascade and its editing rules,
 * and differs only in the cross-section it seeds and a couple of declared
 * behaviours. Adding one is adding a preset -- never a second set of type
 * logic to keep in step with the first.
 */
export type PathKind = "trail" | "street" | "road" | "bridge";

/**
 * What every wall-producing tool needs and nothing else: which wall type,
 * and how tall. There is one wall type in the engine, so a free stroke, a
 * straight run and a tower preset all commit through the same builder with
 * the same parameters -- a preset is a shape, never its own kind of wall.
 *
 * `height` is the length of each panel's own vertical edge, which is all a
 * height ever is here: the graph stores the two horizontal edges and their
 * connection, and the distance between them is this number.
 */
export interface WallParams {
  readonly wallType: "wall-white" | "wall-gray";
  /** Length of a panel's own vertical edge, in world units. */
  readonly height: number;
}

/**
 * A free wall stroke. The brush footprint is not a footprint here -- it is
 * the *fitting tolerance*: a radius of 0 commits the contour literally, and
 * a larger radius lets a shakier stroke be corrected into clean straight
 * runs and true arcs. That is the whole reason a wall brush carries a shape
 * at all, and why its radius floor is 0 rather than the path brush's own.
 */
export interface WallBrushParams extends WallParams, BrushShapeParams {}

/**
 * Sculpt mode determining whether a stroke adds terrain/height ("add"), digs/removes terrain ("dig"), or flattens ("flatten").
 */
export type TerrainSculptMode = "add" | "dig" | "flatten" | "elevate" | "lower";

/**
 * Derives a recommended face size proportionally from the brush radius.
 * Larger brush = broader/macro work = larger faces (fewer quads/vertices).
 * Smaller brush = finer detail work = smaller faces.
 */
export function deriveFaceSize(brushRadius: number, faceSizeOverride?: number): number {
  if (faceSizeOverride !== undefined && faceSizeOverride > 0) {
    return faceSizeOverride;
  }
  const derived = brushRadius / 3;
  return Math.max(1, Math.min(6, Math.round(derived * 4) / 4));
}

/**
 * Ground generated for the area a stroke sweeps, constrained by whatever
 * already stands inside it and submitted as graph nodes/surfaces in one shot -- see
 * `composition/tabletop/tools/terrain/terrain-sculpt-tool.ts`.
 */
export interface TerrainSculptParams {
  /**
   * How wide one terrain face should be, in world units.
   * If omitted or undefined, derived proportionally from {@link brushRadius}.
   */
  readonly faceSize: number;
  /**
   * How wide a band the stroke paints, as a radius in world units.
   */
  readonly brushRadius: number;
  /**
   * Relief manipulation mode:
   * - `"elevate"`: smoothly adds height (+Y) under the brush.
   * - `"lower"`: smoothly subtracts height (-Y) under the brush.
   * - `"flatten"`: normalizes / levels height toward the local average under the brush.
   */
  readonly mode?: TerrainSculptMode;
  /**
   * Height step / intensity applied per stroke (in world Y units). Defaults to 0.5.
   */
  readonly elevationStep?: number;
  /**
   * `0` = cells relaxed hard toward square (regular-looking, like a normal
   * grid); `1` = minimal relaxation, cells keep the raw irregular shape/size
   * variety the random rhombus merge produces. The generator's own relaxation
   * step is what pulls cells toward square in the first place; this is its
   * `strength`, handed across the port as `relaxStrength`.
   */
  readonly irregularity: number;
  /** Multiplies the sampled Perlin noise (native `[-1, 1]`) into world-space height units. */
  readonly heightScale: number;
  /** Perlin `scale` -- smaller values are smoother/larger-scale terrain features. */
  readonly noiseScale: number;
  readonly targetSurface: "terrain" | "terrain-grass";
  readonly seed: number;
}


/**
 * A closed circular wall footprint, stamped in one click at a known radius
 * -- not drawn. This is the "buildings get known geometry, never freehand
 * curves" half of the owner's own split (free brush stays free for
 * fences/paths; a building shape like a tower is a preset instead), see
 * `composition/tabletop/tools/tower/tower-stamp-tool.ts`. `radius` is
 * deliberately restricted to {@link TOWER_RADIUS_PRESETS} -- a small,
 * closed catalog, not a free numeric field -- so every tower on a table is
 * one of a few known sizes a later room-generation pass (Note 0008) can
 * reason about, not an arbitrary one a careless drag produced.
 */
export const TOWER_RADIUS_PRESETS = [1.5, 2.5, 4] as const;
export interface TowerStampParams extends WallParams {
  readonly radius: (typeof TOWER_RADIUS_PRESETS)[number];
}

/**
 * One opening stamped onto a wall panel: a door or a window.
 *
 * An opening is a face like any other -- it is not a marker on the wall and
 * not a hole cut through it. The wall gains an inner loop and this face
 * takes that very loop as its own boundary, so the two share the rim and a
 * wall with a window is still one wall.
 *
 * A door is the same shape standing on the floor, which is why there is one
 * tool and not two. A window's height on the wall is wherever it is placed.
 */
export interface OpeningParams {
  /** A preset of the one opening type: where it starts and what is drawn in it, never its structure. */
  readonly openingKind: "window" | "door";
  /** How wide, measured along the wall rather than across the ground -- a curved wall is travelled, not spanned. */
  readonly width: number;
  readonly height: number;
  /** The outline the next opening gets inside its bounding rectangle. */
  readonly shape: OpeningShape;
}

/** `params` switched to `kind`: a door is at least door-tall. */
export function withOpeningKind(params: OpeningParams, kind: OpeningParams["openingKind"]): OpeningParams {
  return kind === "door" ? { ...params, openingKind: "door", height: Math.max(params.height, 2) } : { ...params, openingKind: "window" };
}

/** The one color each opening preset is drawn in, by the tool's ghost and the panel alike. */
export const OPENING_KIND_COLOR: Readonly<Record<OpeningParams["openingKind"], number>> = Object.freeze({ window: 0x7dd3fc, door: 0xd97706 });

export type OpeningSide = "top" | "right" | "bottom" | "left";

/**
 * An opening's outline inside its bounding rectangle. Each side is straight
 * (radius 0) or a circular arc through that side's midpoint, bulging toward
 * it, with the given radius in world meters; `ellipse` ignores the radii
 * and inscribes an ellipse (a circle when the rectangle is square).
 */
export interface OpeningShape {
  readonly ellipse: boolean;
  readonly radii: Readonly<Record<OpeningSide, number>>;
}

export const RECTANGLE_OPENING_SHAPE: OpeningShape = Object.freeze({
  ellipse: false,
  radii: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
});

export type NoToolParams = Record<string, never>;

/**
 * How a grab on an *existing* structure behaves -- independent of which
 * creation tool is active, since `beginCurveGesture`/the generic grab
 * machinery (`structure-edit-behavior.ts`) work the same regardless of
 * which type owns the grabbed part. Used to live as one tool's own params
 * (`"edit-region"`, since retired); every construction tool now carries it
 * ambiently via `ToolContext.structureEditParams` instead of declaring it
 * as its own.
 */
export interface StructureEditParams {
  readonly mode: "shape" | "elevation";
  readonly curveMode?: "automatic" | "aligned" | "mirrored" | "free";
  readonly curveAction?: "edit" | "remove-anchor" | "disconnect" | "delete-segment" | "close" | "width";
  readonly curveWidth?: number;
  readonly curveEndWidth?: number;
}

export const DEFAULT_STRUCTURE_EDIT_PARAMS: StructureEditParams = Object.freeze({ mode: "shape" });

export interface ToolParamsByTool {
  readonly roof: { readonly shape: "rectangle" | "circle" | "platform"; readonly elevation: number; readonly height: number; readonly radius: number; readonly curvatures: readonly [number, number, number, number] };
  readonly navigate: NoToolParams;
  readonly "platform-contour": { readonly elevation: number; readonly mode: "create" | "extend" | "cut"; readonly shape?: "rectangle" | "polygon" | "freehand" | "circle"; readonly radius?: number; readonly tolerance?: number };
  /** A straight sloped platform dragged from start to end, climbing a fixed rise. */
  readonly "slope-ramp": { readonly width: number; readonly rise: number };
  /** A spiral sloped platform stamped around a clicked centre. */
  readonly "slope-spiral": { readonly width: number; readonly rise: number; readonly radius: number; readonly turns: number };
  readonly "path-brush": PathBrushParams;
  readonly "wall-brush": WallBrushParams;
  readonly "wall-line": WallParams;
  readonly "tower-stamp": TowerStampParams;
  readonly opening: OpeningParams;
  readonly "terrain-sculpt": TerrainSculptParams;
}

export type ToolParamsFor<Id extends ConstructionToolId> = ToolParamsByTool[Id];

export const DEFAULT_TOOL_PARAMS: ToolParamsByTool = Object.freeze({
  roof: Object.freeze({ shape: "rectangle", elevation: 3, height: 2, radius: 2.5, curvatures: [0, 0, 0, 0] as const }),
  navigate: Object.freeze({}),
  "platform-contour": Object.freeze({ elevation: 0, mode: "create", shape: "rectangle", radius: 2.5, tolerance: 0.15 }),
  "slope-ramp": Object.freeze({ width: 1.5, rise: 3 }),
  "slope-spiral": Object.freeze({ width: 1.5, rise: 3, radius: 2.5, turns: 1 }),
  "path-brush": Object.freeze({
    // Legacy brush footprint fields remain readable; authoring now uses explicit curves.
    // `street` is the only preset the UI still writes -- its own bed-only
    // profile is the one everything else in the recipe (shoulder width and
    // height, the still-unbuilt raised rim) is deliberately left inert for.
    shape: "circle", radius: 2.5, rotationDegrees: 0, curveMode: "mirrored",
    pathKind: "street", bedWidth: 3, shoulderWidth: 0.6, shoulderHeight: 0.15,
    miterLimit: 4,
  }),
  "wall-brush": Object.freeze({ wallType: "wall-white", height: 3, shape: "circle", radius: 0.3, rotationDegrees: 0 }),
  "wall-line": Object.freeze({ wallType: "wall-white", height: 3 }),
  "tower-stamp": Object.freeze({ wallType: "wall-white", height: 3, radius: TOWER_RADIUS_PRESETS[1] }),
  opening: Object.freeze({ openingKind: "window", width: 1.2, height: 1.2, shape: RECTANGLE_OPENING_SHAPE }),
  "terrain-sculpt": Object.freeze({
    faceSize: 2,
    brushRadius: 6,
    mode: "add",
    elevationStep: 2.0,
    irregularity: 0.7,
    heightScale: 1.5,
    noiseScale: 0.15,
    targetSurface: "terrain",
    seed: 1,
  }),
});

/**
 * A tool's not-yet-committed ghost, expressed as plain geometry -- no
 * renderer type crosses this boundary (`adapters/rendering` is the only
 * layer allowed to know about `@grafting/render-3d`). `"segments"` draws an
 * open polyline (a wall's centerline while dragging); `"quad"` draws a
 * filled footprint (a terrain brush's reach, a room stamp's proposed
 * outline) as two triangles over 4 corner points.
 */
export type PreviewDescriptor =
  | { readonly kind: "segments"; readonly positions: Float32Array; readonly color: number; readonly opacity?: number }
  | { readonly kind: "quad"; readonly positions: Float32Array; readonly color: number; readonly opacity?: number }
  | { readonly kind: "mesh"; readonly positions: Float32Array; readonly indices: Uint16Array | Uint32Array; readonly color: number; readonly opacity?: number };
