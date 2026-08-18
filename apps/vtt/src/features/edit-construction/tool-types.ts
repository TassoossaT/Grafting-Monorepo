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
  | "move-node"
  | "path-brush"
  | "terrain-brush"
  | "wall-brush"
  | "wall-line"
  | "interior-wall"
  | "tower-stamp"
  | "house-room-delete"
  | "irregular-terrain-stamp";

export interface CircularBrushParams {
  /** World-space radius shared by the terrain and path brushes. */
  readonly radius: number;
}

export interface PathBrushParams extends CircularBrushParams {
  readonly radius: number;
  readonly depth: number;
}

export interface TerrainBrushParams extends CircularBrushParams {
  /** How strongly one pass changes the target, in `(0, 1]`. */
  readonly strength: number;
  readonly targetSurface: "terrain" | "terrain-grass";
  /** Selects among deterministic shape/variant presets -- see `composition/tabletop/tools/terrain-brush-tool.ts`. */
  readonly seed: number;
}

/** Shared by `wall-brush` (free-form drag) and `wall-line` (click point-to-point for an exact straight run) -- they only differ in how they resolve a path's points, not in what a segment is made of. */
export interface WallBrushParams {
  readonly wallType: "wall-white" | "wall-gray";
}

/**
 * One click inside an already-enclosed space (any shape -- `findEnclosingRoom`'s
 * own wall-follower algorithm, not limited to rectangles) rasterizes that
 * space into a `cellSize` grid and hands it to the same region-partition
 * algorithm `ConstructionSessionPort.generateRegionPartition` already
 * exposes (the Rust side the retired "Pintar Casa" brush used to drive one
 * cell at a time) -- see `composition/tabletop/tools/interior-wall-tool.ts`.
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
 * A single seeded, self-contained hexagon of irregular terrain, submitted as
 * graph nodes/surfaces in one shot -- see
 * `composition/tabletop/tools/irregular-terrain-tool.ts`.
 */
export interface IrregularTerrainParams {
  /** Triangles per hexagon edge -- sizes the one whole-stroke lattice built on `onPointerDown` (`composition/tabletop/tools/irregular-terrain-tool.ts`). Bigger means more room to paint before running past the precomputed area, at a one-time (not per-tick) JS cost. */
  readonly trianglesPerSide: number;
  /**
   * `0` = cells relaxed hard toward square (regular-looking, like a normal
   * grid); `1` = minimal relaxation, cells keep the raw irregular shape/size
   * variety `pairTriangles`'s random rhombus merge produces. `irregular-grid.ts`'s
   * own `relax()` step is what pulls cells toward square in the first place --
   * this maps directly onto its `strength` option.
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
 * `composition/tabletop/tools/tower-stamp-tool.ts`. `radius` is
 * deliberately restricted to {@link TOWER_RADIUS_PRESETS} -- a small,
 * closed catalog, not a free numeric field -- so every tower on a table is
 * one of a few known sizes a later room-generation pass (Note 0008) can
 * reason about, not an arbitrary one a careless drag produced.
 */
export const TOWER_RADIUS_PRESETS = [1.5, 2.5, 4] as const;
export interface TowerStampParams {
  readonly wallType: "wall-white" | "wall-gray";
  readonly radius: (typeof TOWER_RADIUS_PRESETS)[number];
}

export type NoToolParams = Record<string, never>;

export interface ToolParamsByTool {
  readonly navigate: NoToolParams;
  readonly "move-node": NoToolParams;
  readonly "path-brush": PathBrushParams;
  readonly "terrain-brush": TerrainBrushParams;
  readonly "wall-brush": WallBrushParams;
  readonly "wall-line": WallBrushParams;
  readonly "interior-wall": InteriorGenerateParams;
  readonly "tower-stamp": TowerStampParams;
  readonly "house-room-delete": NoToolParams;
  readonly "irregular-terrain-stamp": IrregularTerrainParams;
}

export type ToolParamsFor<Id extends ConstructionToolId> = ToolParamsByTool[Id];

export const DEFAULT_TOOL_PARAMS: ToolParamsByTool = Object.freeze({
  navigate: Object.freeze({}),
  "move-node": Object.freeze({}),
  "path-brush": Object.freeze({ radius: 0.25, depth: 0.1 }),
  "terrain-brush": Object.freeze({ radius: 1, strength: 0.6, targetSurface: "terrain", seed: 1 }),
  "wall-brush": Object.freeze({ wallType: "wall-white" }),
  "wall-line": Object.freeze({ wallType: "wall-white" }),
  "interior-wall": Object.freeze({ wallType: "wall-white", cellSize: 2, maxRegionCells: 6, seed: 1 }),
  "tower-stamp": Object.freeze({ wallType: "wall-white", radius: TOWER_RADIUS_PRESETS[1] }),
  "house-room-delete": Object.freeze({}),
  "irregular-terrain-stamp": Object.freeze({
    trianglesPerSide: 10,
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
  | { readonly kind: "quad"; readonly positions: Float32Array; readonly color: number; readonly opacity?: number };
