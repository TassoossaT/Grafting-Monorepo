import type { VisualDefinition, VisualDescriptor } from "../contracts/visual.js";

/** Parameters for the {@link gridVisual} kind. */
export interface GridParams {
  /** Half the grid's world-space span on each axis -- it runs from `-extent` to `extent` on both X and Z. */
  readonly extent: number;
  /** World-space distance between adjacent lines. */
  readonly cellSize: number;
  /** Line color. Defaults to white, so the caller's palette decides. */
  readonly color?: number;
  /** Line opacity, in `(0, 1]`. Defaults to `1`. */
  readonly opacity?: number;
}

function gridPositions(extent: number, cellSize: number): Float32Array {
  if (!(extent > 0)) throw new Error("grid extent must be a positive number");
  if (!(cellSize > 0)) throw new Error("grid cellSize must be a positive number");

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

/**
 * A replaceable default for a bounded ground-plane reference grid, on
 * `y = 0`, spanning `[-extent, extent]` on both X and Z with a line every
 * `cellSize` units.
 *
 * It is here, generic and product-agnostic, for the same reason
 * {@link heightfieldVisual} is: a reference/board grid is not specific to
 * any one product's meaning, only its placement and color are. A product
 * that wants a different default (e.g. a camera-anchored infinite-grid
 * shader instead of bounded line geometry) registers its own kind under a
 * different name and this one costs it nothing.
 */
export const gridVisual: VisualDefinition<GridParams> = {
  kind: "grid",

  describe(params: GridParams): VisualDescriptor {
    return {
      geometry: { shape: "segments", positions: gridPositions(params.extent, params.cellSize) },
      material: { surface: "line", color: params.color ?? 0xffffff, opacity: params.opacity ?? 1 },
    };
  },

  equals(a: GridParams, b: GridParams): boolean {
    return a.extent === b.extent && a.cellSize === b.cellSize && a.color === b.color && a.opacity === b.opacity;
  },
};
