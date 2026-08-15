import { gridVisual, type GridParams, type SceneItem } from "@grafting/render-3d";

export const CONSTRUCTION_GRID_LAYER_ID = "construction-grid";
export const CONSTRUCTION_GRID_MINOR_ITEM_ID = "construction-grid:minor";
export const CONSTRUCTION_GRID_MAJOR_ITEM_ID = "construction-grid:major";
export const CONSTRUCTION_GROUND_LAYER_ID = "construction-ground";
export const CONSTRUCTION_GROUND_ITEM_ID = "construction-ground:plane";
export const CONSTRUCTION_GROUND_VISUAL_KIND = "vtt-construction-ground";

/** Half the grid's world-space span on each axis -- the board runs from `-extent` to `extent` on both X and Z. */
export const CONSTRUCTION_GRID_EXTENT = 25;
const MINOR_CELL_SIZE = 1;
const MAJOR_CELL_SIZE = 5;
/** The unit `use-construction-pointer.ts`'s snap-to-grid option rounds a picked point to -- the same spacing the visible minor grid lines already draw at, so a snapped point always lands exactly on a drawn intersection. */
export const GRID_SNAP_UNIT = MINOR_CELL_SIZE;
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
/**
 * Sits a hair below `y = 0`, so real geometry at or above ground level
 * always raycasts closer to the camera and wins picking naturally wherever
 * it exists -- this plane only ever gets picked in the gaps.
 */
const GROUND_PLANE_Y = -0.02;

/**
 * An invisible, pickable plane spanning the whole grid -- without it,
 * `SceneRenderPort.pick` only ever resolves a point over *existing* map
 * geometry or a node handle (the construction grid's own lines are
 * `pickable: false`, and raycasting against sparse line segments would give
 * poor click coverage even if they weren't). This is what makes the grid
 * usable as a construction base: a construction tool can now generate the
 * *first* piece of geometry in an empty area, not only extend geometry that
 * already exists.
 */
export function constructionGroundSceneItem(): SceneItem<Record<string, never>> {
  return {
    id: CONSTRUCTION_GROUND_ITEM_ID,
    layer: CONSTRUCTION_GROUND_LAYER_ID,
    visual: { kind: CONSTRUCTION_GROUND_VISUAL_KIND, params: {} },
    transform: { position: { x: 0, y: GROUND_PLANE_Y, z: 0 } },
    data: Object.freeze({ entity: "construction-ground" }),
  };
}

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
