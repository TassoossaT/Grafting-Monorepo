import { gridVisual, type GridParams, type SceneItem } from "@grafting/render-3d";

export const CONSTRUCTION_GRID_LAYER_ID = "construction-grid";
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

function gridSceneItem(id: string, params: GridParams): SceneItem<GridParams> {
  return {
    id,
    layer: CONSTRUCTION_GRID_LAYER_ID,
    visual: { kind: gridVisual.kind, params },
    data: Object.freeze({ entity: "construction-grid" }),
  };
}

/**
 * The two static grid scene items (minor + major line tiers) a fresh table
 * shows from the moment its view attaches -- present independent of any
 * generated construction geometry, unlike every other item this adapter
 * draws, which exists to be applied through {@link Render3dSceneAdapter.applyConfirmed}.
 *
 * The grid's own geometry math lives in `@grafting/render-3d`'s
 * {@link gridVisual} -- it has no VTT semantics, only this module's choice of
 * extent/cell-size/color tiers and where the two resulting items sit in this
 * app's own scene (layer, ids) is app-specific.
 */
export function constructionGridSceneItems(): readonly [SceneItem<GridParams>, SceneItem<GridParams>] {
  return [
    gridSceneItem(CONSTRUCTION_GRID_MINOR_ITEM_ID, {
      extent: CONSTRUCTION_GRID_EXTENT,
      cellSize: MINOR_CELL_SIZE,
      color: MINOR_COLOR,
      opacity: MINOR_OPACITY,
    }),
    gridSceneItem(CONSTRUCTION_GRID_MAJOR_ITEM_ID, {
      extent: CONSTRUCTION_GRID_EXTENT,
      cellSize: MAJOR_CELL_SIZE,
      color: MAJOR_COLOR,
      opacity: MAJOR_OPACITY,
    }),
  ];
}
