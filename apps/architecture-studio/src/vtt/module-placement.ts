/**
 * Stage 4: fitting an authored module mesh into an irregular grid cell.
 *
 * A module is modelled once, in a unit cell, and then has to sit in a quad
 * that is neither square nor planar-regular. Placing it by translation and
 * scale would leave gaps, so the unit cell is mapped onto the quad's actual
 * corners -- which is what Townscaper's documented "modular corner pieces that
 * flexibly conform to irregular grid cells" amounts to.
 *
 * The mapping is bilinear:
 *
 *   P(u, v) = (1-u)(1-v)C0 + u(1-v)C1 + uv C2 + (1-u)v C3
 *
 * The property that makes this usable is what happens on a boundary. At v = 0
 * the expression collapses to `(1-u)C0 + u C1`: a straight segment depending
 * only on that edge's two corners, and not at all on the other two. Two quads
 * sharing an edge therefore agree along it no matter how different their
 * remaining corners are -- so modules meet without cracks, for free. What that
 * agreement is worth to the last bit is spelled out on `interpolateEdge`.
 */

import type { QuadMesh, Vec2 } from "./irregular-grid.ts";

/** A point in the module's own unit cell. `u` and `v` span [0, 1]. */
export interface ModuleVertex {
  readonly u: number;
  readonly v: number;
  /** Height above the cell's base, in world units, carried through unchanged. */
  readonly height: number;
}

/** An authored module: geometry in unit-cell coordinates. */
export interface ModuleMesh {
  readonly vertices: readonly ModuleVertex[];
  readonly indices: Uint32Array;
}

/** Where a placed module ended up, as interleaved xyz. */
export interface PlacedModule {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
}

/** Below this, a coordinate counts as lying exactly on a cell boundary. */
const EDGE_EPSILON = 1e-9;

/**
 * Straight interpolation between two corners.
 *
 * How exactly do the two sides of a seam agree? Not bit for bit in double
 * precision, and no reordering trick achieves that: the two quads reach the
 * edge with parameters `t` and `1 - t`, and `1 - (1 - t)` is not `t` in IEEE
 * arithmetic (`0.3` comes back as `0.30000000000000004`). The discrepancy is
 * around 1e-16 and enters through the parameter, not the corner order.
 *
 * What holds instead, and is what actually matters: the result depends only on
 * this edge's two corners, so the two sides differ by rounding rather than by
 * geometry, and both round to the same value once stored as float32 by
 * {@link placeModule}. That is verified across every shared edge of a real
 * irregular grid, not argued. If positions are ever widened to `Float64Array`,
 * that guarantee weakens to "agrees to about 1e-16" and seams would need
 * welding by vertex identity rather than by recomputation.
 */
function interpolateEdge(from: Vec2, to: Vec2, t: number): Vec2 {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** Bilinear interpolation across the quad's interior. */
function interiorPoint(corners: readonly Vec2[], u: number, v: number): Vec2 {
  const [c0, c1, c2, c3] = corners as [Vec2, Vec2, Vec2, Vec2];
  const x =
    (1 - u) * (1 - v) * c0.x + u * (1 - v) * c1.x + u * v * c2.x + (1 - u) * v * c3.x;
  const y =
    (1 - u) * (1 - v) * c0.y + u * (1 - v) * c1.y + u * v * c2.y + (1 - u) * v * c3.y;
  return { x, y };
}

/**
 * Maps one unit-cell point onto the quad.
 *
 * Points on a boundary are routed through `interpolateEdge` so that the result
 * depends only on that edge's two corners. Corner points are returned exactly,
 * with no arithmetic at all.
 */
function mapPoint(corners: readonly Vec2[], u: number, v: number): Vec2 {
  const atLeft = Math.abs(u) < EDGE_EPSILON;
  const atRight = Math.abs(u - 1) < EDGE_EPSILON;
  const atBottom = Math.abs(v) < EDGE_EPSILON;
  const atTop = Math.abs(v - 1) < EDGE_EPSILON;

  // The quad lists corners cyclically, so its edges are (0,1), (1,2), (2,3),
  // (3,0), matching the unit cell's bottom, right, top and left.
  if (atBottom && atLeft) return corners[0] as Vec2;
  if (atBottom && atRight) return corners[1] as Vec2;
  if (atTop && atRight) return corners[2] as Vec2;
  if (atTop && atLeft) return corners[3] as Vec2;

  const edge = (a: number, b: number, t: number): Vec2 =>
    interpolateEdge(corners[a] as Vec2, corners[b] as Vec2, t);

  if (atBottom) return edge(0, 1, u);
  if (atRight) return edge(1, 2, v);
  if (atTop) return edge(3, 2, u);
  if (atLeft) return edge(0, 3, v);

  return interiorPoint(corners, u, v);
}

/** Options controlling where the module sits vertically. */
export interface PlacementOptions {
  /** World height of the cell's floor. Defaults to `0`. */
  readonly baseHeight?: number;
}

/**
 * Places `module` into quad `quadIndex` of `mesh`.
 *
 * Throws rather than producing silent nonsense when asked for a quad the mesh
 * does not have, since a wrong index yields geometry that looks plausible and
 * is wrong.
 */
export function placeModule(
  module: ModuleMesh,
  mesh: QuadMesh,
  quadIndex: number,
  options: PlacementOptions = {},
): PlacedModule {
  const quad = mesh.quads[quadIndex];
  if (quad === undefined) {
    throw new RangeError(
      `quadIndex ${quadIndex} is outside a mesh of ${mesh.quads.length} quads`,
    );
  }
  const corners = quad.map((vertex) => mesh.vertices[vertex]);
  if (corners.some((corner) => corner === undefined)) {
    throw new RangeError(`quad ${quadIndex} refers to a vertex the mesh does not have`);
  }

  const baseHeight = options.baseHeight ?? 0;
  const positions = new Float32Array(module.vertices.length * 3);
  module.vertices.forEach((vertex, index) => {
    const point = mapPoint(corners as Vec2[], vertex.u, vertex.v);
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = baseHeight + vertex.height;
    positions[index * 3 + 2] = point.y;
  });

  return { positions, indices: module.indices };
}
