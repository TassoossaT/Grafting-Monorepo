/**
 * Which cells of the stacked grid hold something.
 *
 * # Why this is not a height per quad
 *
 * It was, and that was a heightfield wearing a 3D grid's clothes: one number
 * per quad says the column is solid from the ground up to `H`, contiguously,
 * always resting on the floor. Everything interesting about building in three
 * dimensions is exactly what that forbids -- an arch, a balcony, a bridge, a
 * second storey wider than the first, a cave. All of them are "occupied at
 * layer 5 with nothing at layer 3", which a single height cannot say.
 *
 * An occupancy is therefore a *set* of `(quad, layer)` cells. The elevation
 * pass stops defining the world and becomes the seed of one
 * ({@link occupancyFromHeights}); after that the world grows a cell at a time
 * ({@link withCell}), which is the shape the world model already assumes when
 * it says generation is fixed and grows incrementally.
 *
 * # Below layer zero is bedrock, not air
 *
 * A cell at layer `0` has nothing under it, and that absence is deliberately
 * *not* treated as exposure: the world rests on something. Only the sides, the
 * top, and the mesh's rim can face air. Treating the underside as exposed would
 * make every ground-level cell part of the shell and give the solver a face to
 * decide that no camera can reach -- the very inversion the shell exists to
 * undo.
 */

/** A cell of the stacked grid: a quad, and how many layers up. */
export interface Cell {
  readonly quad: number;
  readonly layer: number;
}

/**
 * The occupied cells, as a layer set per quad.
 *
 * Quad-major because cell numbering is, so a graph built from an occupancy
 * numbers its cells the same way twice running -- which is what lets a seed
 * reproduce a map.
 */
export interface Occupancy {
  /** How many quads the mesh this describes has. */
  readonly quadCount: number;
  /** One layer above the highest occupied cell; `0` when nothing is occupied. */
  readonly layerCount: number;
  /** Whether `(quad, layer)` holds something. Out-of-range is simply `false`. */
  has(quad: number, layer: number): boolean;
  /** The occupied layers of `quad`, ascending. */
  layersOf(quad: number): readonly number[];
  /** Every occupied cell, quad-major and layer-ascending. */
  cells(): Iterable<Cell>;
  /** How many cells are occupied. */
  readonly size: number;
}

/** Builds an occupancy from an explicit layer set per quad. */
export function occupancyOf(layersPerQuad: readonly (readonly number[])[]): Occupancy {
  const layers = layersPerQuad.map((quadLayers, quad) => {
    for (const layer of quadLayers) {
      if (!Number.isInteger(layer) || layer < 0) {
        throw new RangeError(`quad ${quad} claims layer ${layer}, which is not a layer index`);
      }
    }
    return [...new Set(quadLayers)].sort((left, right) => left - right);
  });

  const sets = layers.map((quadLayers) => new Set(quadLayers));
  const layerCount = layers.reduce(
    (highest, quadLayers) => Math.max(highest, (quadLayers.at(-1) ?? -1) + 1),
    0,
  );

  return {
    quadCount: layers.length,
    layerCount,
    has: (quad, layer) => sets[quad]?.has(layer) ?? false,
    layersOf: (quad) => layers[quad] ?? [],
    *cells() {
      for (const [quad, quadLayers] of layers.entries()) {
        for (const layer of quadLayers) yield { quad, layer };
      }
    },
    size: layers.reduce((total, quadLayers) => total + quadLayers.length, 0),
  };
}

/**
 * The occupancy a height per quad describes: solid from the ground up.
 *
 * This is how the elevation pass still feeds the pipeline. It is a *seed*, not
 * a definition -- once built, an occupancy is edited cell by cell and stops
 * being expressible as heights the moment anything overhangs.
 *
 * @throws RangeError if a height is not a non-negative integer, since a
 * silently wrong stack produces a plausible-looking map that is wrong.
 */
export function occupancyFromHeights(heights: readonly number[]): Occupancy {
  return occupancyOf(
    heights.map((height, quad) => {
      if (!Number.isInteger(height) || height < 0) {
        throw new RangeError(`quad ${quad} has a height of ${height}, which is not a count`);
      }
      return Array.from({ length: height }, (_, layer) => layer);
    }),
  );
}

/** The same occupancy with `(quad, layer)` occupied. The click that builds. */
export function withCell(occupancy: Occupancy, quad: number, layer: number): Occupancy {
  if (quad < 0 || quad >= occupancy.quadCount) {
    throw new RangeError(`quad ${quad} is outside an occupancy of ${occupancy.quadCount} quads`);
  }
  if (occupancy.has(quad, layer)) return occupancy;
  return occupancyOf(
    Array.from({ length: occupancy.quadCount }, (_, index) =>
      index === quad ? [...occupancy.layersOf(index), layer] : occupancy.layersOf(index),
    ),
  );
}

/** The same occupancy with `(quad, layer)` cleared. The click that digs. */
export function withoutCell(occupancy: Occupancy, quad: number, layer: number): Occupancy {
  if (!occupancy.has(quad, layer)) return occupancy;
  return occupancyOf(
    Array.from({ length: occupancy.quadCount }, (_, index) =>
      index === quad
        ? occupancy.layersOf(index).filter((occupied) => occupied !== layer)
        : occupancy.layersOf(index),
    ),
  );
}

/**
 * How many occupied cells sit directly below `(quad, layer)` without a gap.
 *
 * What a renderer needs to know to close a cell's sides: the skirt has to reach
 * the top of whatever is under it, which for ordinary ground is the floor and
 * for an overhang is nothing at all.
 */
export function runBelow(occupancy: Occupancy, quad: number, layer: number): number {
  let depth = 0;
  while (occupancy.has(quad, layer - depth - 1)) depth += 1;
  return depth;
}
