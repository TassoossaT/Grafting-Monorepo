/**
 * The decoded forms this package ships kinds for.
 *
 * Every shape here is structural and renderer-neutral. Nothing imports
 * `@grafting/render-3d`, and nothing should: a catalog that depends on one
 * renderer can only be used by consumers that already chose that renderer,
 * which destroys the reuse this package exists for. The few duplicated
 * interface declarations are the cheaper half of that trade -- the same call
 * `apps/vtt`'s own render port already documents making.
 */

/** A point or extent in resource-local space. */
export interface Vec3 {
  /** Rightward axis. */
  readonly x: number;
  /** Upward axis. */
  readonly y: number;
  /** Depth axis. */
  readonly z: number;
}

/** An axis-aligned bounding box in resource-local space. */
export interface Aabb {
  /** Corner with the smallest coordinate on every axis. */
  readonly min: Vec3;
  /** Corner with the largest coordinate on every axis. */
  readonly max: Vec3;
}

/** Packed geometry, in the resource's own local frame. */
export interface MeshResource {
  /** Flat `xyz` triples, three floats per vertex. */
  readonly positions: Float32Array;
  /** Optional flat `xyz` normal triples. */
  readonly normals?: Float32Array;
  /** Optional flat `uv` pairs, two floats per vertex. */
  readonly uvs?: Float32Array;
  /** Optional triangle indices. Positions are read sequentially when omitted. */
  readonly indices?: Uint16Array | Uint32Array;
  /** Extent of the geometry, so a consumer can lay it out without reading vertices. */
  readonly bounds: Aabb;
}

/**
 * Geometry that arrived as several pieces, kept separate.
 *
 * An authored asset routinely holds more than one primitive. Concatenating
 * them into a single buffer is a real operation, but it is **not this
 * package's**: joining buffers to save a draw call is a decision for whoever
 * draws, and `@grafting/render-3d` already owns an implementation
 * (`mergeMeshChunks`). Duplicating it here would be a second copy of
 * authoritative behaviour that drifts from the first (`DEC-049`).
 *
 * So the store decodes — accessors, node transforms, bounds — and hands over
 * what the file actually contains. A consumer that wants one buffer merges;
 * one that wants per-part materials later, or per-part culling, still can,
 * which a pre-merged buffer would have made impossible.
 */
export interface MeshPartsResource {
  /** One entry per primitive, already in the asset's own world space. */
  readonly parts: readonly MeshResource[];
  /** Union of every part's bounds, so extent is available without merging. */
  readonly bounds: Aabb;
}

/**
 * An image ready for a renderer to consume.
 *
 * Two forms, because a GPU-compressed texture is not a decoded bitmap and never
 * becomes one. Leaving room for `compressed` now is what keeps adopting KTX2 or
 * Basis later an addition rather than a breaking change to the one contract
 * every consumer touches -- and compression is not a micro-optimisation here: a
 * 2048x2048 RGBA texture occupies 16 MB of video memory whatever its file size.
 */
export type ImageResource =
  | {
      readonly form: "decoded";
      /** DOM image types only. No renderer texture type is exposed. */
      readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
      readonly width: number;
      readonly height: number;
      readonly colorSpace: "srgb" | "linear";
    }
  | {
      readonly form: "compressed";
      /** GPU format identifier, e.g. `"bc7-rgba-unorm"`. Interpreted by the renderer. */
      readonly format: string;
      /** Mip levels, largest first. */
      readonly levels: readonly {
        readonly data: Uint8Array;
        readonly width: number;
        readonly height: number;
      }[];
    };
