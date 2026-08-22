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

/**
 * Which chunk one surface's mesh lands in -- shared by the full re-chunk below
 * and `tabletop-runtime.ts`'s own incremental sync, so both agree on chunk
 * membership.
 *
 * The key is spatial bucket **and** covering, not bucket alone. Bucketing by
 * position only meant a bucket holding a wall and a terrain cell merged them
 * into one buffer, which can carry exactly one appearance -- so one of the two
 * silently rendered as the other. Splitting the key is what makes a chunk a set
 * of surfaces that genuinely can share a draw.
 */
export function chunkKeyForSurface(surface: SurfaceMeshResult, resolveCovering: CoveringResolver): string {
  const covering = resolveCovering(surface.surfaceType, surface.physical);
  return `${chunkKeyFor(centroidOf(surface.mesh))}|${covering.key}`;
}

/**
 * A resolved covering as this adapter needs to see it. Structurally matches
 * `entities/map`'s `SurfaceCovering`; declared here so the adapter depends on a
 * shape rather than on a product slice.
 */
export interface ResolvedCovering {
  readonly kind: string;
  readonly key: string;
  /** `undefined` for a covering that draws no surface mesh. */
  readonly surface: { readonly color: number } | undefined;
}

/**
 * Resolves a surface's visual fill. Supplied by the caller rather than imported
 * so this adapter stays a translator: `entities/map` owns the policy, and no
 * adapter here reaches upstream into a product slice to ask what something
 * should look like.
 */
export type CoveringResolver = (surfaceType: string, physical: boolean) => ResolvedCovering;

/** Merges one spatial chunk's current member surfaces into the one `RenderMapChunk` buffer `SceneRenderPort.applyConfirmed` expects -- `undefined` for an empty bucket (the caller should remove the chunk instead of upserting it). See {@link chunkSurfaceMeshes}'s own doc for why a chunk is always a full re-merge of its members, never a per-surface patch. */
export function mergeChunkBucket(
  chunkId: string,
  members: readonly SurfaceMeshResult[],
  resolveCovering: CoveringResolver,
): RenderMapChunk | undefined {
  const [first] = members;
  if (first === undefined) return undefined;
  // Safe to read the covering off any one member: `chunkKeyForSurface` keys the
  // bucket by covering, so every member of a chunk resolves to the same one.
  const covering = resolveCovering(first.surfaceType, first.physical);
  // A covering that draws no mesh produces no chunk at all -- the same result an
  // empty bucket gives, and handled by the same caller path. This is what makes
  // "invisible" free: no buffer, no draw call, and no notion of `none` anywhere
  // downstream of here.
  if (covering.surface === undefined) return undefined;
  return {
    chunkId,
    covering: { kind: covering.kind, key: covering.key, color: covering.surface.color },
    mesh: mergeMeshChunks(members.map((surface) => surface.mesh)),
  };
}

/**
 * Buckets triangulated construction surfaces into spatial chunks (via the
 * existing {@link chunkKeyFor}) and merges each bucket's meshes into one
 * buffer (via `@grafting/render-3d`'s existing `mergeMeshChunks`), producing
 * the `RenderMapChunk`s `SceneRenderPort.applyConfirmed` expects.
 *
 * Surfaces that look different never share a chunk: {@link chunkKeyForSurface}
 * keys by covering as well as position, so the merged buffer always has exactly
 * one appearance to carry.
 */
export function chunkSurfaceMeshes(
  surfaces: readonly SurfaceMeshResult[],
  resolveCovering: CoveringResolver,
): readonly RenderMapChunk[] {
  const byChunk = new Map<string, SurfaceMeshResult[]>();
  for (const surface of surfaces) {
    const chunkId = chunkKeyForSurface(surface, resolveCovering);
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