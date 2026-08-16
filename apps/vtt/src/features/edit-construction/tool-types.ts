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
  | "terrain-brush"
  | "wall-brush"
  | "room-stamp"
  | "room-derive"
  | "house-stamp"
  | "irregular-terrain-stamp";

export interface TerrainBrushParams {
  /** World-space brush radius -- how far one stroke sample reaches. */
  readonly radius: number;
  /** How strongly one pass changes the target, in `(0, 1]`. */
  readonly strength: number;
  readonly targetSurface: "terrain" | "terrain-grass";
  /** Selects among deterministic shape/variant presets -- see `composition/tabletop/tools/terrain-brush-tool.ts`. */
  readonly seed: number;
}

/** Door generation is a separate concern from wall-brush for now -- see `room-seed.ts` for the still-valid case, a procedurally generated room's own doors. */
export interface WallBrushParams {
  readonly wallType: "wall-white" | "wall-gray";
  readonly seed: number;
}

export interface RoomStampParams {
  /** Drives footprint size/door placement variety, in `[0, 1]`. */
  readonly complexity: number;
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
 * A rectangular footprint partitioned into `roomCount` connected rooms of
 * varied size, stamped in one commit -- all treemap/weld math happens on
 * the Rust side (`ConstructionSessionPort.generateRoomGrid`), this tool
 * only picks where, how big, and which seed.
 */
export interface HouseStampParams {
  readonly width: number;
  readonly depth: number;
  readonly roomCount: number;
  readonly seed: number;
}

export type NoToolParams = Record<string, never>;

export interface ToolParamsByTool {
  readonly navigate: NoToolParams;
  readonly "move-node": NoToolParams;
  readonly "terrain-brush": TerrainBrushParams;
  readonly "wall-brush": WallBrushParams;
  readonly "room-stamp": RoomStampParams;
  readonly "room-derive": NoToolParams;
  readonly "house-stamp": HouseStampParams;
  readonly "irregular-terrain-stamp": IrregularTerrainParams;
}

export type ToolParamsFor<Id extends ConstructionToolId> = ToolParamsByTool[Id];

export const DEFAULT_TOOL_PARAMS: ToolParamsByTool = Object.freeze({
  navigate: Object.freeze({}),
  "move-node": Object.freeze({}),
  "terrain-brush": Object.freeze({ radius: 1, strength: 0.6, targetSurface: "terrain", seed: 1 }),
  "wall-brush": Object.freeze({ wallType: "wall-white", seed: 1 }),
  "room-stamp": Object.freeze({ complexity: 0.5, seed: 1 }),
  "room-derive": Object.freeze({}),
  "house-stamp": Object.freeze({ width: 12, depth: 8, roomCount: 4, seed: 1 }),
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
