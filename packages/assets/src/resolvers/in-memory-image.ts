import type { AssetDefinition } from "../contracts/definition.js";
import type { ImageResource } from "../contracts/resource.js";
import type { ResourceResolver } from "../contracts/resolver.js";
import { disposeImageResource, imageResourceBytes } from "./image-ownership.js";

/** The kind {@link inMemoryImageResolver} claims. */
export const IN_MEMORY_IMAGE_KIND = "in-memory-image";

/** What an in-memory image definition puts in its `source`. */
export interface InMemoryImageSource {
  /** The already-decoded image. Ownership passes to the store. */
  readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  /** Width in pixels, used to report the decoded memory cost. */
  readonly width: number;
  /** Height in pixels, used to report the decoded memory cost. */
  readonly height: number;
  /** Defaults to `"srgb"`, which is what colour textures are authored in. */
  readonly colorSpace?: "srgb" | "linear";
}

/**
 * Adopts an already-decoded image the caller produced, and takes over its
 * disposal.
 *
 * Zero-dependency by construction: it decodes nothing, so it needs no parser --
 * whoever created the bitmap, canvas or element hands it over and stops owning
 * it. That makes it the seam any future decoder plugs into, and useful on its
 * own for generated textures.
 *
 * The disposal here is the point. `ImageBitmap` is not garbage collected and
 * must be closed explicitly; three.js shipped this exact defect for years,
 * where `Texture.dispose()` left the underlying bitmap open and textures
 * decoded from `.glb` leaked despite disposal that looked correct
 * (mrdoob/three.js#23953). Owning disposal in one place is what makes that a
 * one-line fix instead of an audit of every call site.
 */
export const inMemoryImageResolver: ResourceResolver<typeof IN_MEMORY_IMAGE_KIND> = {
  kind: IN_MEMORY_IMAGE_KIND,
  async load(definition: AssetDefinition<typeof IN_MEMORY_IMAGE_KIND>): Promise<never> {
    const input = definition.source as InMemoryImageSource | undefined;
    if (input?.source === undefined) {
      throw new Error(`"${definition.ref}" declares no image source`);
    }
    const image: ImageResource = {
      form: "decoded",
      source: input.source,
      width: input.width,
      height: input.height,
      colorSpace: input.colorSpace ?? "srgb",
    };
    return image as never;
  },
  dispose(resource): void {
    disposeImageResource(resource as unknown as ImageResource);
  },
  sizeOf(resource): number {
    return imageResourceBytes(resource as unknown as ImageResource);
  },
};
