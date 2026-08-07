import type { QuadMesh } from "./irregular-grid.ts";

/**
 * Turns the 2D grid into the buffers `@grafting/render-3d` draws.
 *
 * Kept apart from the algorithm so the grid itself stays free of any rendering
 * concern and testable without one — the algorithm is what moves to Rust
 * later, and this is what stays behind.
 *
 * The grid lies on the XZ plane with Y up, matching the engine's convention.
 */

/** Triangulated cell interiors, as a flat `xyz` position buffer with indices. */
export function quadSurface(mesh: QuadMesh): { positions: Float32Array; indices: Uint32Array } {
  const positions = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach((vertex, index) => {
    positions[index * 3] = vertex.x;
    positions[index * 3 + 1] = 0;
    positions[index * 3 + 2] = vertex.y;
  });

  const indices = new Uint32Array(mesh.quads.length * 6);
  mesh.quads.forEach((quad, index) => {
    const [a, b, c, d] = quad;
    // Two triangles across the a-c diagonal. The diagonal is invisible in the
    // filled surface, and the cell outlines come from `quadOutlines` rather
    // than from this triangulation, so nothing exposes it.
    indices.set([a, b, c, a, c, d], index * 6);
  });

  return { positions, indices };
}

/**
 * The four edges of every cell, as line-segment pairs.
 *
 * Built from the quads directly rather than derived from the triangulated
 * surface: a wireframe of that surface would draw each cell's diagonal too,
 * showing a triangulation the grid does not actually have.
 */
export function quadOutlines(mesh: QuadMesh): Float32Array {
  const seen = new Set<string>();
  const points: number[] = [];

  for (const quad of mesh.quads) {
    for (let corner = 0; corner < 4; corner += 1) {
      const from = quad[corner];
      const to = quad[(corner + 1) % 4];
      if (from === undefined || to === undefined) continue;

      // Interior edges belong to two cells; drawing them once halves the
      // segment count and avoids overdrawn, darker shared edges.
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const a = mesh.vertices[from];
      const b = mesh.vertices[to];
      if (a === undefined || b === undefined) continue;
      points.push(a.x, 0, a.y, b.x, 0, b.y);
    }
  }

  return new Float32Array(points);
}

/** Cell centres, useful as the anchors a later tile solve would place modules on. */
export function quadCentres(mesh: QuadMesh): Float32Array {
  const centres = new Float32Array(mesh.quads.length * 3);
  mesh.quads.forEach((quad, index) => {
    let x = 0;
    let y = 0;
    for (const corner of quad) {
      const vertex = mesh.vertices[corner];
      if (vertex === undefined) continue;
      x += vertex.x;
      y += vertex.y;
    }
    centres[index * 3] = x / 4;
    centres[index * 3 + 1] = 0;
    centres[index * 3 + 2] = y / 4;
  });
  return centres;
}
