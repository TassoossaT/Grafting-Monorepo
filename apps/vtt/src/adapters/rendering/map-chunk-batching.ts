import { mergeMeshChunks, type Vec3 } from "@grafting/render-3d";

import type { RenderMapChunk, RenderMeshData, SurfaceMeshResult } from "@/ports";

import { chunkKeyFor } from "./map-chunk-key.ts";

/** The mean of a mesh's vertex positions, used only to pick a spatial chunk bucket. */
function centroidOf(mesh: RenderMeshData): Vec3 {
  const { positions } = mesh;
  const vertexCount = positions.length / 3;
  if (vertexCount === 0) return { x: 0, y: 0, z: 0 };

  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < positions.length; index += 3) {
    x += positions[index] ?? 0;
    y += positions[index + 1] ?? 0;
    z += positions[index + 2] ?? 0;
  }
  return { x: x / vertexCount, y: y / vertexCount, z: z / vertexCount };
}

/**
 * Buckets triangulated construction surfaces into spatial chunks (via the
 * existing {@link chunkKeyFor}) and merges each bucket's meshes into one
 * buffer (via `@grafting/render-3d`'s existing `mergeMeshChunks`), producing
 * the `RenderMapChunk`s `SceneRenderPort.applyConfirmed` expects. A chunk
 * that mixes surface types (e.g. a wall and a terrain cell landing in the
 * same bucket) takes its first surface's `surfaceType`/`physical` for
 * classification -- `colorForSurfaceType`'s flat placeholder coloring
 * doesn't yet need finer granularity than that (see `E4.2`).
 */
export function chunkSurfaceMeshes(surfaces: readonly SurfaceMeshResult[]): readonly RenderMapChunk[] {
  const byChunk = new Map<string, SurfaceMeshResult[]>();
  for (const surface of surfaces) {
    const chunkId = chunkKeyFor(centroidOf(surface.mesh));
    const bucket = byChunk.get(chunkId);
    if (bucket === undefined) byChunk.set(chunkId, [surface]);
    else bucket.push(surface);
  }

  const chunks: RenderMapChunk[] = [];
  for (const [chunkId, bucket] of byChunk) {
    const [first] = bucket;
    if (first === undefined) continue;
    chunks.push({
      chunkId,
      surfaceType: first.surfaceType,
      physical: first.physical,
      mesh: mergeMeshChunks(bucket.map((surface) => surface.mesh)),
    });
  }
  return chunks;
}
