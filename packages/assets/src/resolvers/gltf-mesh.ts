import { WebIO, type Document, type Node, type Primitive } from "@gltf-transform/core";

import type { AssetDefinition } from "../contracts/definition.js";
import type { Aabb, MeshPartsResource, MeshResource } from "../contracts/resource.js";
import type { ResourceResolver } from "../contracts/resolver.js";

/** The kind {@link gltfMeshResolver} claims. */
export const GLTF_MESH_KIND = "gltf-mesh";

/**
 * What a glTF mesh definition puts in its `source`.
 *
 * Two forms rather than one, because the two real situations differ: content
 * fetched from wherever a catalogue points, and content already in hand —
 * generated, uploaded by a user, or read from storage the store knows nothing
 * about.
 */
export type GltfMeshSource =
  /** Bytes of a `.glb`, or of a self-contained `.gltf`, already in memory. */
  | { readonly bytes: Uint8Array }
  /** A location to fetch the bytes from. */
  | { readonly url: string };

/** A 4x4 column-major transform, as glTF stores one. */
type Matrix = ReadonlyArray<number>;

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Applies a column-major 4x4 to a point. */
function transformPoint(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  return [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
  ];
}

/**
 * Applies a transform to a direction, ignoring translation.
 *
 * Correct for rotation and uniform scale, which is what authored assets
 * overwhelmingly use. Non-uniform scale would need the inverse-transpose;
 * normals are renormalised below, so uniform scale costs nothing and
 * non-uniform scale degrades to a slightly wrong normal rather than to
 * garbage — a deliberate trade for the first version, not an oversight.
 */
function transformDirection(m: Matrix, x: number, y: number, z: number): [number, number, number] {
  const out: [number, number, number] = [
    (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z,
    (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z,
    (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z,
  ];
  const length = Math.hypot(out[0], out[1], out[2]);
  return length === 0 ? out : [out[0] / length, out[1] / length, out[2] / length];
}

function readPrimitive(primitive: Primitive, matrix: Matrix): MeshResource | undefined {
  const position = primitive.getAttribute("POSITION");
  if (position === null) return undefined;

  const source = position.getArray();
  if (source === null) return undefined;
  const vertexCount = position.getCount();

  const positions = new Float32Array(vertexCount * 3);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const [x, y, z] = transformPoint(
      matrix,
      source[vertex * 3] ?? 0,
      source[vertex * 3 + 1] ?? 0,
      source[vertex * 3 + 2] ?? 0,
    );
    positions[vertex * 3] = x;
    positions[vertex * 3 + 1] = y;
    positions[vertex * 3 + 2] = z;
  }

  const normalAccessor = primitive.getAttribute("NORMAL");
  const normalSource = normalAccessor?.getArray() ?? null;
  let normals: Float32Array | undefined;
  if (normalSource !== null) {
    normals = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      const [x, y, z] = transformDirection(
        matrix,
        normalSource[vertex * 3] ?? 0,
        normalSource[vertex * 3 + 1] ?? 0,
        normalSource[vertex * 3 + 2] ?? 0,
      );
      normals[vertex * 3] = x;
      normals[vertex * 3 + 1] = y;
      normals[vertex * 3 + 2] = z;
    }
  }

  const uvAccessor = primitive.getAttribute("TEXCOORD_0");
  const uvSource = uvAccessor?.getArray() ?? null;
  const uvs = uvSource === null ? undefined : Float32Array.from(uvSource);

  // Index width follows the data: 16 bits cannot address past 65535 vertices.
  // An indexless primitive is a plain triangle list, given explicit indices
  // here so every part has the same shape.
  const indexAccessor = primitive.getIndices();
  const indexSource = indexAccessor?.getArray() ?? null;
  const indexCount = indexSource === null ? vertexCount : indexSource.length;
  const indices: Uint16Array | Uint32Array =
    vertexCount > 0xffff ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  for (let index = 0; index < indexCount; index += 1) {
    indices[index] = indexSource === null ? index : (indexSource[index] ?? 0);
  }

  return { positions, normals, uvs, indices, bounds: boundsOf(positions) };
}

/** Every primitive reachable from the document's scenes, in world space. */
function collectParts(document: Document): MeshResource[] {
  const parts: MeshResource[] = [];
  const visit = (node: Node): void => {
    const mesh = node.getMesh();
    const matrix = node.getWorldMatrix() ?? IDENTITY;
    if (mesh !== null) {
      for (const primitive of mesh.listPrimitives()) {
        const part = readPrimitive(primitive, matrix);
        if (part !== undefined) parts.push(part);
      }
    }
    for (const child of node.listChildren()) visit(child);
  };

  for (const scene of document.getRoot().listScenes()) {
    for (const node of scene.listChildren()) visit(node);
  }
  return parts;
}

function boundsOf(positions: Float32Array): Aabb {
  if (positions.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/** Union of every part's own bounds. */
function unionBounds(parts: readonly MeshResource[]): Aabb {
  const first = parts[0];
  if (first === undefined) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  }
  let { min, max } = first.bounds;
  for (const part of parts.slice(1)) {
    min = {
      x: Math.min(min.x, part.bounds.min.x),
      y: Math.min(min.y, part.bounds.min.y),
      z: Math.min(min.z, part.bounds.min.z),
    };
    max = {
      x: Math.max(max.x, part.bounds.max.x),
      y: Math.max(max.y, part.bounds.max.y),
      z: Math.max(max.z, part.bounds.max.z),
    };
  }
  return { min, max };
}

async function bytesFor(source: GltfMeshSource): Promise<Uint8Array> {
  if ("bytes" in source) return source.bytes;
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`fetching ${source.url} failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Loads authored geometry from a glTF 2.0 asset.
 *
 * Opening the container is the easy part; the work is resolving accessors --
 * component types, byte strides, sparse accessors, 16- versus 32-bit indices.
 * `@gltf-transform/core` does that, and is used here rather than three's
 * `GLTFLoader` for one structural reason: it depends on no renderer, so the
 * store stays usable by consumers that never chose three (`ADR-0011`).
 *
 * No glTF type escapes this module. The result is a plain {@link MeshResource},
 * as every other resolver produces.
 *
 * Node transforms **are** applied, because interpreting the scene hierarchy is
 * part of reading the format. Concatenating the resulting primitives into one
 * buffer is not: that is a draw-call decision owned by whoever draws, and
 * `@grafting/render-3d` already implements it as `mergeMeshChunks`. Producing
 * separate {@link MeshPartsResource} parts keeps this package from carrying a
 * second copy of that algorithm (`DEC-049`), and leaves per-part materials or
 * per-part culling possible later — which a pre-merged buffer would have
 * foreclosed.
 *
 * **This first version brings geometry only.** Materials, textures and
 * animation clips are deliberately out: each becomes its own registered kind
 * later, without changing a single contract — the property open kinds were
 * chosen for.
 */
export const gltfMeshResolver: ResourceResolver<typeof GLTF_MESH_KIND> = {
  kind: GLTF_MESH_KIND,
  async load(definition: AssetDefinition<typeof GLTF_MESH_KIND>): Promise<never> {
    const source = definition.source as GltfMeshSource | undefined;
    if (source === undefined) throw new Error(`"${definition.ref}" declares no glTF source`);

    const bytes = await bytesFor(source);
    const document = await new WebIO().readBinary(bytes);
    const parts = collectParts(document);
    if (parts.length === 0) {
      throw new Error(`"${definition.ref}" contains no drawable primitive`);
    }
    return { parts, bounds: unionBounds(parts) } as never;
  },
  sizeOf(resource): number {
    const mesh = resource as unknown as MeshPartsResource;
    return mesh.parts.reduce(
      (total, part) =>
        total +
        part.positions.byteLength +
        (part.normals?.byteLength ?? 0) +
        (part.uvs?.byteLength ?? 0) +
        (part.indices?.byteLength ?? 0),
      0,
    );
  },
};
