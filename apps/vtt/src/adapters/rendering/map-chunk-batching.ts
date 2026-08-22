import { mergeMeshChunks, type Vec3 } from "@grafting/render-3d";

import type { RenderCovering, RenderMapChunk, RenderMeshData, SurfaceMeshResult } from "@/ports";

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

/** Which spatial chunk bucket one surface's mesh lands in -- shared by the full re-chunk below and `tabletop-runtime.ts`'s own incremental sync, so both agree on chunk membership. */
export function chunkKeyForSurface(surface: SurfaceMeshResult): string {
  return chunkKeyFor(centroidOf(surface.mesh));
}

/**
 * Resolves a surface's visual fill. Supplied by the caller rather than imported
 * so this adapter stays a translator: `entities/map` owns the policy, and no
 * adapter here reaches upstream into a product slice to ask what something
 * should look like.
 */
export type CoveringResolver = (surfaceType: string, physical: boolean) => RenderCovering;

/** Merges one spatial chunk's current member surfaces into the one `RenderMapChunk` buffer `SceneRenderPort.applyConfirmed` expects -- `undefined` for an empty bucket (the caller should remove the chunk instead of upserting it). See {@link chunkSurfaceMeshes}'s own doc for why a chunk is always a full re-merge of its members, never a per-surface patch. */
export function mergeChunkBucket(
  chunkId: string,
  members: readonly SurfaceMeshResult[],
  resolveCovering: CoveringResolver,
): RenderMapChunk | undefined {
  const [first] = members;
  if (first === undefined) return undefined;
  return {
    chunkId,
    surfaceType: first.surfaceType,
    physical: first.physical,
    covering: resolveCovering(first.surfaceType, first.physical),
    mesh: mergeMeshChunks(members.map((surface) => surface.mesh)),
  };
}

/**
 * Buckets triangulated construction surfaces into spatial chunks (via the
 * existing {@link chunkKeyFor}) and merges each bucket's meshes into one
 * buffer (via `@grafting/render-3d`'s existing `mergeMeshChunks`), producing
 * the `RenderMapChunk`s `SceneRenderPort.applyConfirmed` expects.
 *
 * **Known defect, not yet fixed here:** a chunk that mixes surface types (a
 * wall and a terrain cell landing in the same bucket) takes its *first*
 * surface's `surfaceType`/`physical`, so both render with whichever
 * classification happened to land first. Harmless only while every covering is
 * the same flat placeholder; the fix is to key chunks by
 * `(spatialBucket x covering.key)` rather than by bucket alone -- see phase 2
 * of `docs/architecture/vtt-surface-covering-transformation-plan.md`.
 * `SurfaceCovering.key` exists for exactly that and is deliberately unused so
 * far.
 */
export function chunkSurfaceMeshes(
  surfaces: readonly SurfaceMeshResult[],
  resolveCovering: CoveringResolver,
): readonly RenderMapChunk[] {
  const byChunk = new Map<string, SurfaceMeshResult[]>();
  for (const surface of surfaces) {
    const chunkId = chunkKeyForSurface(surface);
    const bucket = byChunk.get(chunkId);
    if (bucket === undefined) byChunk.set(chunkId, [surface]);
    else bucket.push(surface);
  }

  const chunks: RenderMapChunk[] = [];
  for (const [chunkId, bucket] of byChunk) {
    const chunk = mergeChunkBucket(chunkId, bucket, resolveCovering);
    if (chunk !== undefined) chunks.push(chunk);
  }
  return chunks;
}

/** Merges exact per-surface preview meshes into one renderer-neutral mesh descriptor. */
export function mergeSurfaceMeshes(surfaces: readonly SurfaceMeshResult[]): RenderMeshData {
  return mergeMeshChunks(surfaces.map((surface) => surface.mesh));
}