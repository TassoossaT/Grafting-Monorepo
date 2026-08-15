import type { SceneItem } from "@grafting/render-3d";

export const CONSTRUCTION_GRID_LAYER_ID = "construction-grid";
export const CONSTRUCTION_GRID_VISUAL_KIND = "vtt-construction-grid";
export const CONSTRUCTION_GRID_MINOR_ITEM_ID = "construction-grid:minor";
export const CONSTRUCTION_GRID_MAJOR_ITEM_ID = "construction-grid:major";

/** Half the grid's world-space span on each axis -- the board runs from `-extent` to `extent` on both X and Z. */
export const CONSTRUCTION_GRID_EXTENT = 25;
const MINOR_CELL_SIZE = 1;
const MAJOR_CELL_SIZE = 5;
/** Muted line color, barely brighter than the scene background so it reads as a reference surface, not a drawn element. */
const MINOR_COLOR = 0x1f2f36;
const MINOR_OPACITY = 0.35;
/** Every 5th line, brighter, so the grid still conveys scale at a glance instead of reading as uniform noise. */
const MAJOR_COLOR = 0x3d5a52;
const MAJOR_OPACITY = 0.55;

export interface ConstructionGridParams {
  readonly positions: Float32Array;
  readonly color: number;
  readonly opacity: number;
}

/**
 * Builds the flat `xyz` line-segment endpoints for a bounded square grid on
 * the ground plane (`y = 0`, matching where walls and terrain are seeded --
 * see `WallSegment`'s own `y: 0` base convention), spanning
 * `[-extent, extent]` on both X and Z with a line every `cellSize` units.
 *
 * A bounded grid rather than an infinite shader-driven one: the board reads
 * as a literal tabuleiro the GM builds on, matching Townscaper's persistent
 * build-grid and this repo's own "board" product language, and it is cheap
 * enough (a handful of line segments) that camera-anchored regeneration
 * buys nothing here.
 */
export function buildConstructionGridPositions(extent: number, cellSize: number): Float32Array {
  if (!(extent > 0)) throw new Error("construction grid extent must be a positive number");
  if (!(cellSize > 0)) throw new Error("construction grid cellSize must be a positive number");

  const lineCount = Math.floor((extent * 2) / cellSize) + 1;
  const positions: number[] = [];
  for (let index = 0; index < lineCount; index += 1) {
    const offset = -extent + index * cellSize;
    // Line parallel to Z, at fixed X.
    positions.push(offset, 0, -extent, offset, 0, extent);
    // Line parallel to X, at fixed Z.
    positions.push(-extent, 0, offset, extent, 0, offset);
  }
  return Float32Array.from(positions);
}

function gridSceneItem(id: string, params: ConstructionGridParams): SceneItem<ConstructionGridParams> {
  return {
    id,
    layer: CONSTRUCTION_GRID_LAYER_ID,
    visual: { kind: CONSTRUCTION_GRID_VISUAL_KIND, params },
    data: Object.freeze({ entity: "construction-grid" }),
  };
}

/**
 * The two static grid scene items (minor + major line tiers) a fresh table
 * shows from the moment its view attaches -- present independent of any
 * generated construction geometry, unlike every other item this adapter
 * draws, which exists to be applied through {@link Render3dSceneAdapter.applyConfirmed}.
 */
export function constructionGridSceneItems(): readonly [
  SceneItem<ConstructionGridParams>,
  SceneItem<ConstructionGridParams>,
] {
  return [
    gridSceneItem(CONSTRUCTION_GRID_MINOR_ITEM_ID, {
      positions: buildConstructionGridPositions(CONSTRUCTION_GRID_EXTENT, MINOR_CELL_SIZE),
      color: MINOR_COLOR,
      opacity: MINOR_OPACITY,
    }),
    gridSceneItem(CONSTRUCTION_GRID_MAJOR_ITEM_ID, {
      positions: buildConstructionGridPositions(CONSTRUCTION_GRID_EXTENT, MAJOR_CELL_SIZE),
      color: MAJOR_COLOR,
      opacity: MAJOR_OPACITY,
    }),
  ];
}
