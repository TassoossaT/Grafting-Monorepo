import type { QuadMesh } from "./irregular-grid.ts";

/**
 * Stage 3 of the Townscaper pipeline: smooth the hard steps stage 2 leaves.
 *
 * The move that does the work is not the mesher, it is the change of model.
 * Stage 2 attaches elevation to **cells**, so each cell is a box and two
 * neighbours at different levels meet at a vertical face. Here occupancy
 * attaches to **corner columns**: a cell at level `n` marks all four of its
 * corners as solid up to `n`, and a corner shared by cells at different levels
 * takes the highest of them. The rendered surface is then the boundary of that
 * union, which passes *between* samples rather than through them — so a step
 * comes out chamfered instead of square. Townscaper gets the same result from
 * a hand-authored set of about fifteen shapes; the fifteen shapes are art on
 * top of this model, not a different one.
 *
 * The surface is extracted with marching **tetrahedra**, not marching cubes.
 * Each cell-layer hexahedron is split into six tetrahedra, and a tetrahedron
 * has only sixteen corner states, all four of which shapes are derived here in
 * a few lines. Marching cubes would need its 256-row triangle table, and the
 * widely-copied versions of that table have no clear licence — the research
 * registry has already discarded two grid repositories on exactly that ground.
 * A table reproduced by hand would also fail quietly: a wrong row shows up as
 * one malformed cell somewhere in a thousand.
 *
 * Cells are irregular, so the hexahedron being marched is a deformed box. That
 * costs nothing here, because every cut point is the midpoint of two real
 * corner positions and every triangle's winding is decided from the actual
 * geometry rather than read out of a table authored for a unit cube.
 */

interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Which corner columns are solid, and how far up. */
export interface CornerOccupancy {
  /** One past the highest solid layer across the whole grid. */
  readonly layerCount: number;
  /** Highest solid layer at a corner column, or `-1` if it is empty. */
  topLayer(vertex: number): number;
  /** Whether the column at `vertex` is solid at `layer`. */
  filled(vertex: number, layer: number): boolean;
}

/**
 * Turns stage 2's per-cell levels into per-corner-column occupancy.
 *
 * A corner takes the **highest** level among the cells meeting at it. That is
 * what makes the union bulge outward at a step, and it is the whole reason the
 * result reads as rounded rather than stepped: the low cell's shared corners
 * are pulled up by its taller neighbour, and the surface crosses the gap on a
 * diagonal.
 *
 * @param mesh - The irregular quad grid.
 * @param levels - One integer level per cell, in the mesh's quad order.
 */
export function cornerOccupancy(mesh: QuadMesh, levels: ArrayLike<number>): CornerOccupancy {
  const highestAt = new Int32Array(mesh.vertices.length).fill(-1);

  mesh.quads.forEach((quad, cell) => {
    const level = Math.trunc(levels[cell] ?? 0);
    for (const corner of quad) {
      if (corner === undefined) continue;
      if (level > (highestAt[corner] ?? -1)) highestAt[corner] = level;
    }
  });

  let highest = -1;
  for (const value of highestAt) highest = Math.max(highest, value);

  return {
    layerCount: highest + 1,
    topLayer: (vertex) => highestAt[vertex] ?? -1,
    filled: (vertex, layer) => layer >= 0 && layer <= (highestAt[vertex] ?? -1),
  };
}

/** Options for {@link buildTransitionTerrain}. */
export interface TransitionTerrainOptions {
  /** World height of one discrete level, matching stage 2's option of the same name. */
  readonly levelHeight?: number;
  /** Y the outer skirt descends to, giving the terrain visible thickness at the grid's edge. */
  readonly baseHeight?: number;
}

/** Triangulated terrain, split so a caller can shade the parts differently. */
export interface TransitionTerrain {
  /** Flat `xyz` triples for every generated corner; no vertex is shared between triangles. */
  readonly positions: Float32Array;
  /** Triangles facing predominantly upward. */
  readonly topIndices: Uint32Array;
  /** The chamfers and vertical faces between cells at different levels. */
  readonly sideIndices: Uint32Array;
  /** The wall closing the open rim at the grid's boundary down to `baseHeight`. */
  readonly skirtIndices: Uint32Array;
}

/**
 * Three tetrahedra covering a triangular prism, indexed into
 * `[a, b, c, a', b', c']` — the bottom triangle followed by the top one.
 *
 * This split is only conforming if `a < b < c` by **global** vertex index. Two
 * prisms sharing a vertical face share that face's two columns, so both derive
 * the same diagonal across it from the same ordering, and the surface cannot
 * crack along the seam. A fixed local split — a fan around one corner of a box,
 * say — has no such guarantee: the two cells number their shared face's corners
 * differently and can pick opposing diagonals, which shows up as a hairline gap
 * only on some pairs of cells and only at some levels.
 */
const PRISM_TETRAHEDRA: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 5],
  [0, 1, 4, 5],
  [0, 3, 4, 5],
];

/** Below this the surface is treated as facing sideways rather than up. */
const TOP_FACING_Y = 0.5;

/**
 * Extracts the boundary of the corner-column occupancy as a triangle mesh.
 *
 * Layer `0` is never given an underside: everything below it counts as solid,
 * so the terrain is open underneath exactly as stage 2's is, and the sides are
 * closed by a skirt rather than by a floor.
 *
 * @param mesh - The irregular quad grid.
 * @param levels - One integer level per cell, in the mesh's quad order.
 */
export function buildTransitionTerrain(
  mesh: QuadMesh,
  levels: ArrayLike<number>,
  options: TransitionTerrainOptions = {},
): TransitionTerrain {
  const levelHeight = options.levelHeight ?? 0.25;
  const baseHeight = options.baseHeight ?? -0.6;
  const occupancy = cornerOccupancy(mesh, levels);

  const positions: number[] = [];
  const topIndices: number[] = [];
  const sideIndices: number[] = [];
  const skirtIndices: number[] = [];

  const pushPoint = (point: Point3): number => {
    const index = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    return index;
  };

  // A sample at layer L sits half a level low, so that the surface between a
  // solid layer n and an empty n + 1 lands exactly on y = n * levelHeight and
  // a flat plateau agrees with stage 2 rather than floating half a step above.
  const yOfLayer = (layer: number): number => (layer - 0.5) * levelHeight;

  const corner: Point3[] = new Array<Point3>(6);
  const solid: boolean[] = new Array<boolean>(6);

  for (const quad of mesh.quads) {
    for (const triangle of splitQuad(quad)) {
      // Sorting by global index is what makes neighbouring prisms agree on the
      // diagonal of the vertical face they share; see PRISM_TETRAHEDRA.
      const columns = [...triangle].sort((a, b) => a - b);
      const vertices = columns.map((column) => mesh.vertices[column]);
      if (vertices.some((vertex) => vertex === undefined)) continue;

      for (let layer = 0; layer < occupancy.layerCount; layer += 1) {
        vertices.forEach((vertex, index) => {
          const column = columns[index];
          if (vertex === undefined || column === undefined) return;
          // The grid is 2D: its `y` is the world's `z`, and height is the new axis.
          corner[index] = { x: vertex.x, y: yOfLayer(layer), z: vertex.y };
          corner[index + 3] = { x: vertex.x, y: yOfLayer(layer + 1), z: vertex.y };
          solid[index] = occupancy.filled(column, layer);
          solid[index + 3] = occupancy.filled(column, layer + 1);
        });

        for (const tetrahedron of PRISM_TETRAHEDRA) {
          emitTetrahedron(tetrahedron, corner, solid, pushPoint, topIndices, sideIndices);
        }
      }
    }
  }

  closeRim(positions, [topIndices, sideIndices], baseHeight, pushPoint, skirtIndices);

  return {
    positions: new Float32Array(positions),
    topIndices: new Uint32Array(topIndices),
    sideIndices: new Uint32Array(sideIndices),
    skirtIndices: new Uint32Array(skirtIndices),
  };
}

/**
 * Cuts a cell into two triangular columns.
 *
 * Which diagonal is used only has to be stable, not shared: this face belongs
 * to one cell, and the same rule runs at every layer, so no neighbour ever sees
 * it. Deriving it from the vertex indices rather than always taking `0-2` keeps
 * the result independent of the order the grid happened to emit corners in.
 */
function splitQuad(quad: readonly number[]): readonly (readonly [number, number, number])[] {
  const [a, b, c, d] = quad;
  if (a === undefined || b === undefined || c === undefined || d === undefined) return [];
  return Math.min(a, c) <= Math.min(b, d)
    ? [
        [a, b, c],
        [a, c, d],
      ]
    : [
        [b, c, d],
        [b, d, a],
      ];
}

/**
 * The whole marching-tetrahedra case analysis, without a lookup table.
 *
 * Only the *counts* matter, because a tetrahedron's corners are
 * interchangeable: one corner cut off gives a triangle, two gives a quad, and
 * three is one corner cut off from the other side. Winding is then decided by
 * comparing the triangle's own normal against the direction from the solid
 * corners to the empty ones, which is correct for any deformed tetrahedron and
 * cannot silently disagree with a table authored for a unit cube.
 */
function emitTetrahedron(
  tetrahedron: readonly [number, number, number, number],
  corner: readonly Point3[],
  solid: readonly boolean[],
  pushPoint: (point: Point3) => number,
  topIndices: number[],
  sideIndices: number[],
): void {
  const inside = tetrahedron.filter((index) => solid[index] === true);
  const outside = tetrahedron.filter((index) => solid[index] !== true);
  if (inside.length === 0 || outside.length === 0) return;

  const midpoint = (a: number, b: number): Point3 => {
    const first = corner[a];
    const second = corner[b];
    if (first === undefined || second === undefined) return { x: 0, y: 0, z: 0 };
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 };
  };

  const triangles: Point3[][] = [];
  if (inside.length === 1) {
    const [only] = inside;
    if (only === undefined) return;
    triangles.push(outside.map((other) => midpoint(only, other)));
  } else if (outside.length === 1) {
    const [only] = outside;
    if (only === undefined) return;
    triangles.push(inside.map((other) => midpoint(only, other)));
  } else {
    const [a, b] = inside;
    const [c, d] = outside;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return;
    // Cyclic around the quad: consecutive midpoints always share one corner.
    const quad = [midpoint(a, c), midpoint(a, d), midpoint(b, d), midpoint(b, c)];
    const [m0, m1, m2, m3] = quad;
    if (m0 === undefined || m1 === undefined || m2 === undefined || m3 === undefined) return;
    triangles.push([m0, m1, m2], [m0, m2, m3]);
  }

  const outward = subtract(centroid(outside, corner), centroid(inside, corner));

  for (const triangle of triangles) {
    const [a, b, c] = triangle;
    if (a === undefined || b === undefined || c === undefined) continue;

    let normal = cross(subtract(b, a), subtract(c, a));
    const area = length(normal);
    if (area < 1e-12) continue;
    normal = { x: normal.x / area, y: normal.y / area, z: normal.z / area };

    const ordered = dot(normal, outward) < 0 ? [a, c, b] : [a, b, c];
    const facingUp = (dot(normal, outward) < 0 ? -normal.y : normal.y) > TOP_FACING_Y;
    const target = facingUp ? topIndices : sideIndices;
    for (const point of ordered) target.push(pushPoint(point));
  }
}

/**
 * Closes the mesh's open boundary with a vertical skirt.
 *
 * Marching only covers cells that exist, so at the grid's edge the surface
 * simply stops and leaves the terrain looking like paper from a low camera.
 * The rim is found rather than assumed: an edge used by exactly one triangle is
 * on a hole, wherever that hole came from. Reusing the edge's own direction
 * keeps the skirt wound the same way as the surface it hangs from.
 */
function closeRim(
  positions: readonly number[],
  surfaces: readonly (readonly number[])[],
  baseHeight: number,
  pushPoint: (point: Point3) => number,
  skirtIndices: number[],
): void {
  const pointAt = (index: number): Point3 => ({
    x: positions[index * 3] ?? 0,
    y: positions[index * 3 + 1] ?? 0,
    z: positions[index * 3 + 2] ?? 0,
  });

  // Positions are duplicated per triangle, so edges only pair up once
  // coincident corners are welded by position.
  const welded = new Map<string, number>();
  const weldOf = (index: number): number => {
    const point = pointAt(index);
    const key = `${quantise(point.x)}:${quantise(point.y)}:${quantise(point.z)}`;
    const existing = welded.get(key);
    if (existing !== undefined) return existing;
    welded.set(key, index);
    return index;
  };

  const uses = new Map<string, { from: number; to: number; count: number }>();
  for (const indices of surfaces) {
    for (let at = 0; at + 2 < indices.length; at += 3) {
      const triangle = [indices[at], indices[at + 1], indices[at + 2]];
      for (let edge = 0; edge < 3; edge += 1) {
        const rawFrom = triangle[edge];
        const rawTo = triangle[(edge + 1) % 3];
        if (rawFrom === undefined || rawTo === undefined) continue;
        const from = weldOf(rawFrom);
        const to = weldOf(rawTo);
        const key = from < to ? `${from}:${to}` : `${to}:${from}`;
        const seen = uses.get(key);
        if (seen) seen.count += 1;
        else uses.set(key, { from, to, count: 1 });
      }
    }
  }

  for (const { from, to, count } of uses.values()) {
    if (count !== 1) continue;
    const fromTop = pointAt(from);
    const toTop = pointAt(to);
    if (fromTop.y <= baseHeight && toTop.y <= baseHeight) continue;
    // A rim edge that is already vertical would drop onto itself, producing a
    // zero-area quad rather than a wall.
    if (Math.abs(fromTop.x - toTop.x) < 1e-9 && Math.abs(fromTop.z - toTop.z) < 1e-9) continue;

    const fromBase = { x: fromTop.x, y: baseHeight, z: fromTop.z };
    const toBase = { x: toTop.x, y: baseHeight, z: toTop.z };
    const a = pushPoint(fromTop);
    const b = pushPoint(toTop);
    const c = pushPoint(toBase);
    const d = pushPoint(fromBase);
    skirtIndices.push(a, b, c, a, c, d);
  }
}

function quantise(value: number): number {
  return Math.round(value * 1e5);
}

function centroid(indices: readonly number[], corner: readonly Point3[]): Point3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const index of indices) {
    const point = corner[index];
    if (point === undefined) continue;
    x += point.x;
    y += point.y;
    z += point.z;
  }
  const count = indices.length || 1;
  return { x: x / count, y: y / count, z: z / count };
}

function subtract(a: Point3, b: Point3): Point3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Point3, b: Point3): Point3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Point3, b: Point3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(point: Point3): number {
  return Math.sqrt(dot(point, point));
}
