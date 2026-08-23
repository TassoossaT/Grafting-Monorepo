/**
 * A product-agnostic store for the content an application renders.
 *
 * It answers what content exists, whether it is loaded, and who is holding it.
 * It never answers how anything is drawn: filtering, batching, shaders, GPU
 * upload and scene membership all belong to a renderer, and product meaning
 * belongs to the app. Holding that line is what keeps this package usable by
 * consumers that share none of those choices.
 *
 * Nothing here reaches for a file. Formats arrive as registered resolvers and
 * catalogues as registered sources, so where content lives is the caller's
 * decision -- a local folder, a CDN, IndexedDB, a manifest, or pure code.
 */

export { resourceRef } from "./contracts/ref.js";
export type { ResourceKind, ResourceKinds, ResourceOf, ResourceRef } from "./contracts/ref.js";

export type {
  Aabb,
  ImageResource,
  MeshPartsResource,
  MeshResource,
  Vec3,
} from "./contracts/resource.js";

export type { AssetDefinition, AssetProvenance } from "./contracts/definition.js";

export type { CatalogSource, ResourceResolver } from "./contracts/resolver.js";

export type {
  AssetStore,
  AssetStoreOptions,
  DeclarationOutcome,
  InventoryEntry,
  RejectionReason,
  ResourceHandle,
  ResourceStatus,
  RetentionPolicy,
  StoreEvent,
} from "./contracts/store.js";

export { createAssetStore } from "./store/create-store.js";

export { PRIMITIVE_MESH_KIND, primitiveMeshResolver } from "./resolvers/primitive-mesh.js";
export type { PrimitiveMeshSource } from "./resolvers/primitive-mesh.js";

export { IN_MEMORY_IMAGE_KIND, inMemoryImageResolver } from "./resolvers/in-memory-image.js";
export type { InMemoryImageSource } from "./resolvers/in-memory-image.js";

export { ENCODED_IMAGE_KIND, createEncodedImageResolver } from "./resolvers/encoded-image.js";
export type {
  DecodedImage,
  EncodedImageBytes,
  EncodedImageResolverOptions,
  EncodedImageSource,
  ImageColorSpace,
} from "./resolvers/encoded-image.js";

export { GLTF_MESH_KIND, gltfMeshResolver } from "./resolvers/gltf-mesh.js";
export type { GltfMeshSource } from "./resolvers/gltf-mesh.js";
