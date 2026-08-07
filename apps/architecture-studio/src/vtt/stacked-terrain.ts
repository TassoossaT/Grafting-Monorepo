import type { QuadMesh, Vec2 } from "./irregular-grid.ts";

/**
 * Stage 2 of the Townscaper pipeline: give the flat irregular grid relief.
 *
 * Elevation attaches to **cells**, not to vertices. A cell sits wholly at one
 * discrete level, so neighbouring cells at different levels meet at a vertical
 * wall rather than a slope. That stepping is the look, and it is also what
 * makes the later tile solve tractable — a module can be authored against
 * "this cell is two levels above that one" instead of against a continuous
 * surface it would have to conform to.
 *
 * Smoothing those steps is a further stage: Townscaper resolves the transition
 * between filled and empty corners with a hand-authored marching-cubes-style
 * set of about fifteen shapes. This produces the honest hard step, which is
 * what those shapes would later replace, not an approximation of them.
 */

/** A regular grid of samples, as {@link generate_heightmap} produces. */
export interface Heightfield {
  readonly width: number;
  readonly height: number;
  /** Row-major samples, `width * height` of them, nominally in `[-1, 1]`. */
  readonly values: Float32Array;
}

/**
 * Reads a regular heightfield at an arbitrary point.
 *
 * Needed because the cells are irregular and the noise source is not: nothing
 * lines a cell centre up with a sample. Bilinear rather than nearest, so two
 * adjacent cells cannot land on the same sample and flatten a step that should
 * exist.
 *
 * @param field - The sampled grid.
 * @param u - Horizontal position in `[0, 1]` across the field.
 * @param v - Vertical position in `[0, 1]` across the field.
 */
export function sampleHeightfield(field: Heightfield, u: number, v: number): number {
  const { width, height, values } = field;
  if (width < 1 || height < 1) return 0;

  const x = clamp(u, 0, 1) * (width - 1);
  const y = clamp(v, 0, 1) * (height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;

  const at = (column: number, row: number) => values[row * width + column] ?? 0;
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Geometric centre of each cell, and the grid's extent, in one pass. */
export interface CellCentres {
  readonly centres: readonly Vec2[];
  readonly min: Vec2;
  readonly max: Vec2;
}

/** Cell centres plus the bounding box needed to map them into a heightfield. */
export function cellCentres(mesh: QuadMesh): CellCentres {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const centres = mesh.quads.map((quad) => {
    let x = 0;
    let y = 0;
    for (const corner of quad) {
      const vertex = mesh.vertices[corner];
      if (vertex === undefined) continue;
      x += vertex.x;
      y += vertex.y;
    }
    const centre = { x: x / 4, y: y / 4 };
    minX = Math.min(minX, centre.x);
    minY = Math.min(minY, centre.y);
    maxX = Math.max(maxX, centre.x);
    maxY = Math.max(maxY, centre.y);
    return centre;
  });

  return {
    centres,
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
  };
}

/**
 * Samples one continuous value per cell, ready to hand to the Rust
 * `discretize` crate.
 *
 * Kept separate from the quantisation itself so the discrete levels stay the
 * Rust crate's output rather than being recomputed here — the repository has
 * one authoritative binning implementation and this is not it.
 */
export function sampleCellValues(mesh: QuadMesh, field: Heightfield): Float32Array {
  const { centres, min, max } = cellCentres(mesh);
  const spanX = max.x - min.x || 1;
  const spanY = max.y - min.y || 1;

  const values = new Float32Array(centres.length);
  centres.forEach((centre, index) => {
    values[index] = sampleHeightfield(field, (centre.x - min.x) / spanX, (centre.y - min.y) / spanY);
  });
  return values;
}

/** Options for {@link buildStackedTerrain}. */
export interface StackedTerrainOptions {
  /** World height of one discrete level. Level `n` has its top at `n * levelHeight`. */
  readonly levelHeight?: number;
  /**
   * Y the outermost walls descend to. Defaults to `0`, which leaves a level-0
   * cell with no skirt at all; a negative value gives the terrain visible
   * thickness at the grid's edge.
   */
  readonly baseHeight?: number;
}

/** Triangulated terrain, split so a caller can shade tops and walls differently. */
export interface StackedTerrain {
  /** Flat `xyz` triples for every generated corner. */
  readonly positions: Float32Array;
  /** Triangles covering the flat top of each cell. */
  readonly topIndices: Uint32Array;
  /** Triangles covering the vertical faces between cells at different levels. */
  readonly wallIndices: Uint32Array;
}

/**
 * Extrudes each cell to its own level and closes the steps between them.
 *
 * A wall is emitted on an edge only where the cell on the other side is
 * genuinely lower, or absent at the grid boundary. Emitting one per edge
 * regardless would double every interior face and leave surfaces buried inside
 * the terrain, which cost nothing visually and everything in triangle count.
 *
 * @param mesh - The irregular quad grid.
 * @param levels - One integer level per cell, in the mesh's quad order.
 */
export function buildStackedTerrain(
  mesh: QuadMesh,
  levels: ArrayLike<number>,
  options: StackedTerrainOptions = {},
): StackedTerrain {
  const levelHeight = options.levelHeight ?? 0.25;
  const baseHeight = options.baseHeight ?? 0;

  const positions: number[] = [];
  const topIndices: number[] = [];
  const wallIndices: number[] = [];

  const pushVertex = (point: Vec2, y: number): number => {
    const index = positions.length / 3;
    positions.push(point.x, y, point.y);
    return index;
  };

  const neighbours = edgeNeighbours(mesh);
  // Level 0 sits at y = 0. The base is where the outer wall descends to, not
  // an offset applied to every cell — folding it into the top would make a
  // level-0 cell flush with the base and silently drop its wall.
  const heightOf = (cell: number): number => (levels[cell] ?? 0) * levelHeight;

  mesh.quads.forEach((quad, cell) => {
    const corners = quad.map((index) => mesh.vertices[index]);
    if (corners.some((corner) => corner === undefined)) return;
    const top = heightOf(cell);

    // Each cell owns its own top corners rather than sharing vertices with its
    // neighbours: two cells at different levels must not be welded, or the
    // step between them would be smoothed into a slope.
    const topRing = corners.map((corner) => pushVertex(corner as Vec2, top));
    const [t0, t1, t2, t3] = topRing;
    if (t0 === undefined || t1 === undefined || t2 === undefined || t3 === undefined) return;
    topIndices.push(t0, t2, t1, t0, t3, t2);

    for (let edge = 0; edge < 4; edge += 1) {
      const from = quad[edge];
      const to = quad[(edge + 1) % 4];
      if (from === undefined || to === undefined) continue;

      const neighbour = neighbours.get(edgeKey(from, to))?.find((other) => other !== cell);
      const bottom = neighbour === undefined ? baseHeight : heightOf(neighbour);
      if (bottom >= top) continue;

      const a = mesh.vertices[from];
      const b = mesh.vertices[to];
      if (a === undefined || b === undefined) continue;

      const aTop = pushVertex(a, top);
      const bTop = pushVertex(b, top);
      const aBottom = pushVertex(a, bottom);
      const bBottom = pushVertex(b, bottom);
      wallIndices.push(aTop, bTop, bBottom, aTop, bBottom, aBottom);
    }
  });

  return {
    positions: new Float32Array(positions),
    topIndices: new Uint32Array(topIndices),
    wallIndices: new Uint32Array(wallIndices),
  };
}

/** Which cells touch each edge. An interior edge has two; a boundary edge one. */
export function edgeNeighbours(mesh: QuadMesh): Map<string, number[]> {
  const map = new Map<string, number[]>();
  mesh.quads.forEach((quad, cell) => {
    for (let edge = 0; edge < 4; edge += 1) {
      const from = quad[edge];
      const to = quad[(edge + 1) % 4];
      if (from === undefined || to === undefined) continue;
      const key = edgeKey(from, to);
      const owners = map.get(key);
      if (owners) owners.push(cell);
      else map.set(key, [cell]);
    }
  });
  return map;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
