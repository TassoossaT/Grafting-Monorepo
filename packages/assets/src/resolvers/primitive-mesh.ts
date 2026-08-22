import type { AssetDefinition } from "../contracts/definition.js";
import type { MeshResource } from "../contracts/resource.js";
import type { ResourceResolver } from "../contracts/resolver.js";

/** The kind {@link primitiveMeshResolver} claims. */
export const PRIMITIVE_MESH_KIND = "primitive-mesh";

/** What a primitive mesh definition puts in its `source`. */
export type PrimitiveMeshSource =
  | { readonly shape: "box"; readonly width: number; readonly height: number; readonly depth: number }
  | { readonly shape: "plane"; readonly width: number; readonly depth: number };

const BOX_FACES: readonly {
  readonly normal: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[];
}[] = [
  { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
];

const FACE_UVS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

function boxMesh(width: number, height: number, depth: number): MeshResource {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const halfDepth = depth / 2;
  const positions = new Float32Array(BOX_FACES.length * 4 * 3);
  const normals = new Float32Array(positions.length);
  const uvs = new Float32Array(BOX_FACES.length * 4 * 2);
  const indices = new Uint16Array(BOX_FACES.length * 6);

  BOX_FACES.forEach((face, faceIndex) => {
    face.corners.forEach((corner, cornerIndex) => {
      const vertex = faceIndex * 4 + cornerIndex;
      positions[vertex * 3] = (corner[0] ?? 0) * halfWidth;
      positions[vertex * 3 + 1] = (corner[1] ?? 0) * halfHeight;
      positions[vertex * 3 + 2] = (corner[2] ?? 0) * halfDepth;
      normals[vertex * 3] = face.normal[0];
      normals[vertex * 3 + 1] = face.normal[1];
      normals[vertex * 3 + 2] = face.normal[2];
      const uv = FACE_UVS[cornerIndex] ?? [0, 0];
      uvs[vertex * 2] = uv[0];
      uvs[vertex * 2 + 1] = uv[1];
    });
    const base = faceIndex * 4;
    const target = faceIndex * 6;
    indices[target] = base;
    indices[target + 1] = base + 1;
    indices[target + 2] = base + 2;
    indices[target + 3] = base;
    indices[target + 4] = base + 2;
    indices[target + 5] = base + 3;
  });

  return {
    positions,
    normals,
    uvs,
    indices,
    bounds: {
      min: { x: -halfWidth, y: -halfHeight, z: -halfDepth },
      max: { x: halfWidth, y: halfHeight, z: halfDepth },
    },
  };
}

function planeMesh(width: number, depth: number): MeshResource {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  return {
    positions: new Float32Array([
      -halfWidth, 0, halfDepth,
      halfWidth, 0, halfDepth,
      halfWidth, 0, -halfDepth,
      -halfWidth, 0, -halfDepth,
    ]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    bounds: { min: { x: -halfWidth, y: 0, z: -halfDepth }, max: { x: halfWidth, y: 0, z: halfDepth } },
  };
}

/**
 * Builds geometry from parameters, with no file and no dependency.
 *
 * This is the store's floor, and it is deliberately always available. Because
 * asset binaries are not versioned in this repository, a fresh clone has none,
 * and CI must not reach for an external host -- so something has to be
 * loadable with nothing but code. A box is that something: it needs no import,
 * no licence and no network, which makes it both the cheapest way to start and
 * the permanent fallback when a real asset is missing.
 */
export const primitiveMeshResolver: ResourceResolver<typeof PRIMITIVE_MESH_KIND> = {
  kind: PRIMITIVE_MESH_KIND,
  async load(definition: AssetDefinition<typeof PRIMITIVE_MESH_KIND>): Promise<never> {
    const source = definition.source as PrimitiveMeshSource | undefined;
    if (source === undefined) throw new Error(`"${definition.ref}" declares no primitive source`);
    const mesh =
      source.shape === "box"
        ? boxMesh(source.width, source.height, source.depth)
        : planeMesh(source.width, source.depth);
    return mesh as never;
  },
  sizeOf(resource): number {
    const mesh = resource as unknown as MeshResource;
    return (
      mesh.positions.byteLength +
      (mesh.normals?.byteLength ?? 0) +
      (mesh.uvs?.byteLength ?? 0) +
      (mesh.indices?.byteLength ?? 0)
    );
  },
};
