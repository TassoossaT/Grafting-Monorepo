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
  | "edit-region"
  | "path-brush"
  | "wall-brush"
  | "wall-line"
  | "interior-wall"
  | "tower-stamp"
  | "opening"
  | "house-room-delete"
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
 * One click inside an already-enclosed space (any shape -- `findEnclosingRoom`'s
 * own wall-follower algorithm, not limited to rectangles) rasterizes that
 * space into a `cellSize` grid and hands it to the same region-partition
 * algorithm `ConstructionSessionPort.generateRegionPartition` already
 * exposes (the Rust side the retired "Pintar Casa" brush used to drive one
 * cell at a time) -- see `composition/tabletop/tools/house/interior-wall-tool.ts`.
 * A region larger than `maxRegionCells` auto-splits into more than one
 * room, so the same enclosed footprint can regenerate into a different
 * layout just by changing `seed`/`maxRegionCells`. No floor/ceiling
 * (not implemented yet) -- only the generated cap surfaces are stripped
 * back out client-side after the engine call.
 */
export interface InteriorGenerateParams {
  readonly wallType: "wall-white" | "wall-gray";
  /** World-space side length of one grid cell. */
  readonly cellSize: number;
  /** A connected region larger than this many cells gets auto-split into more than one room. */
  readonly maxRegionCells: number;
  /** Drives the split layout's jitter -- the same enclosed footprint always reproduces the same rooms for a given seed. */
  readonly seed: number;
}

/**
 * Ground generated for the area a stroke sweeps, constrained by whatever
 * already stands inside it and submitted as graph nodes/surfaces in one shot -- see
 * `composition/tabletop/tools/terrain/terrain-sculpt-tool.ts`.
 */
export interface TerrainSculptParams {
  /**
   * How wide one terrain face should be, in world units.
   *
   * A face, not a lattice triangle: the engine converts. Bigger is cheaper in
   * a way that is felt rather than measured -- halving it roughly quadruples
   * the faces a stroke registers, and the graph, the render sync and the
   * scene all carry every one of them.
   */
  readonly faceSize: number;
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
 * A door is the same shape with its sill on the floor, which is why there is
 * one tool and not two.
 */
export interface OpeningParams {
  readonly openingType: "window" | "door";
  /** How wide, measured along the wall rather than across the ground -- a curved wall is travelled, not spanned. */
  readonly width: number;
  readonly height: number;
  /** How far above the wall's own base the opening starts. Zero is a door. */
  readonly sill: number;
}

export type NoToolParams = Record<string, never>;

export interface ToolParamsByTool {
  readonly navigate: NoToolParams;
  readonly "edit-region": NoToolParams;
  readonly "path-brush": PathBrushParams;
  readonly "wall-brush": WallBrushParams;
  readonly "wall-line": WallParams;
  readonly "interior-wall": InteriorGenerateParams;
  readonly "tower-stamp": TowerStampParams;
  readonly opening: OpeningParams;
  readonly "house-room-delete": NoToolParams;
  readonly "terrain-sculpt": TerrainSculptParams;
}

export type ToolParamsFor<Id extends ConstructionToolId> = ToolParamsByTool[Id];

export const DEFAULT_TOOL_PARAMS: ToolParamsByTool = Object.freeze({
  navigate: Object.freeze({}),
  "edit-region": Object.freeze({}),
  "path-brush": Object.freeze({
    // The brush has to hold the road: half of a 3-wide bed reaches 1.5 from
    // the centerline, so a radius of 2.5 leaves a full metre of correction.
    // `street` is the only preset the UI still writes -- its own bed-only
    // profile is the one everything else in the recipe (shoulder width and
    // height, the still-unbuilt raised rim) is deliberately left inert for.
    shape: "circle", radius: 2.5, rotationDegrees: 0,
    pathKind: "street", bedWidth: 3, shoulderWidth: 0.6, shoulderHeight: 0.15,
    miterLimit: 4,
  }),
  "wall-brush": Object.freeze({ wallType: "wall-white", height: 3, shape: "circle", radius: 0.3, rotationDegrees: 0 }),
  "wall-line": Object.freeze({ wallType: "wall-white", height: 3 }),
  "interior-wall": Object.freeze({ wallType: "wall-white", cellSize: 2, maxRegionCells: 6, seed: 1 }),
  "tower-stamp": Object.freeze({ wallType: "wall-white", height: 3, radius: TOWER_RADIUS_PRESETS[1] }),
  opening: Object.freeze({ openingType: "window", width: 1.2, height: 1.2, sill: 1 }),
  "house-room-delete": Object.freeze({}),
  "terrain-sculpt": Object.freeze({
    faceSize: 2,
    irregularity: 0.7,
    heightScale: 1.5,
    noiseScale: 0.15,
    targetSurface: "terrain-grass",
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
