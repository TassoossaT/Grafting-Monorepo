import type { MeshData } from "../contracts/visual.js";

/**
 * Concatenates several meshes into one buffer, offsetting each piece's
 * indices past everything already appended.
 *
 * Pure array arithmetic, useful to any caller batching many small meshes
 * into one draw call — not something specific to any one product's idea of
 * a "chunk". A caller that groups geometry into spatial buckets (a chunked
 * terrain, a merged prop cluster, anything else that wants one buffer per
 * bucket) calls this once per bucket.
 *
 * A piece without its own `indices` is a flat triangle list (`GeometryDescriptor`'s
 * own "positions read sequentially when omitted" rule) — merged as an
 * implicit `0..n-1` index run, never by dropping indices from every *other*
 * piece just because one piece lacks them; that would silently discard the
 * shared-vertex structure indexed pieces depend on.
 */
export function mergeMeshChunks(pieces: readonly MeshData[]): MeshData {
  if (pieces.length === 0) {
    return { positions: new Float32Array(0) };
  }
  if (pieces.length === 1) {
    const [only] = pieces;
    return only as MeshData;
  }

  let vertexCount = 0;
  let hasNormals = true;
  let hasUvs = true;
  let anyIndices = false;
  let outputIndexCount = 0;
  let maxOutputIndex = 0;
  let runningVertexOffset = 0;

  for (const piece of pieces) {
    const pieceVertexCount = piece.positions.length / 3;
    vertexCount += pieceVertexCount;
    hasNormals &&= piece.normals !== undefined;
    hasUvs &&= piece.uvs !== undefined;
    if (piece.indices) anyIndices = true;
    outputIndexCount += piece.indices?.length ?? pieceVertexCount;
    maxOutputIndex = runningVertexOffset + pieceVertexCount - 1;
    runningVertexOffset += pieceVertexCount;
  }

  const positions = new Float32Array(vertexCount * 3);
  const normals = hasNormals ? new Float32Array(vertexCount * 3) : undefined;
  const uvs = hasUvs ? new Float32Array(vertexCount * 2) : undefined;
  const indices = anyIndices
    ? maxOutputIndex > 0xffff
      ? new Uint32Array(outputIndexCount)
      : new Uint16Array(outputIndexCount)
    : undefined;

  let vertexOffset = 0;
  let indexOffset = 0;
  for (const piece of pieces) {
    const pieceVertexCount = piece.positions.length / 3;
    positions.set(piece.positions, vertexOffset * 3);
    if (normals && piece.normals) normals.set(piece.normals, vertexOffset * 3);
    if (uvs && piece.uvs) uvs.set(piece.uvs, vertexOffset * 2);

    if (indices) {
      if (piece.indices) {
        const pieceIndices = piece.indices;
        for (let i = 0; i < pieceIndices.length; i += 1) {
          indices[indexOffset + i] = (pieceIndices[i] ?? 0) + vertexOffset;
        }
        indexOffset += pieceIndices.length;
      } else {
        for (let i = 0; i < pieceVertexCount; i += 1) {
          indices[indexOffset + i] = vertexOffset + i;
        }
        indexOffset += pieceVertexCount;
      }
    }

    vertexOffset += pieceVertexCount;
  }

  return { positions, normals, uvs, indices };
}
