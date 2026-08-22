import type { AssetDefinition } from "../contracts/definition.js";
import type { ImageResource } from "../contracts/resource.js";
import type { ResourceResolver } from "../contracts/resolver.js";
import { disposeImageResource, imageResourceBytes } from "./image-ownership.js";

/** The kind {@link createEncodedImageResolver} claims. */
export const ENCODED_IMAGE_KIND = "encoded-image";

/**
 * Where an encoded image's bytes come from.
 *
 * The same two cases as the glTF resolver, for the same reason: bytes that were
 * generated, uploaded by a user, or read from storage this package knows
 * nothing about must work exactly as well as a fetch. Which one a definition
 * uses is invisible to everything upstream of the resolver.
 */
export type EncodedImageBytes =
  /** Encoded bytes of a PNG, JPEG, WebP -- whatever the decoder accepts. */
  | { readonly bytes: Uint8Array }
  /** A location to fetch the bytes from. */
  | { readonly url: string };

/**
 * How a colour channel's values are to be read.
 *
 * Declared per image, never assumed, because a PBR material is not one texture.
 * Base colour is authored in sRGB; normal, roughness, ambient occlusion and
 * height are linear data that merely happen to be stored in an image. Decoding
 * a normal map as sRGB does not fail -- it produces lighting that is subtly and
 * consistently wrong, which is the kind of defect that survives review and is
 * obvious only on screen.
 *
 * There is no safe default across a material's maps, so the declaration carries
 * it and this resolver never guesses. `"srgb"` is the fallback only because a
 * lone texture with nothing said about it is far more often colour.
 */
export type ImageColorSpace = "srgb" | "linear";

/** What an encoded image definition puts in its `source`. */
export type EncodedImageSource = EncodedImageBytes & {
  /**
   * How this image's values are read. Defaults to `"srgb"`.
   *
   * Set `"linear"` for every map that carries data rather than colour.
   */
  readonly colorSpace?: ImageColorSpace;
  /**
   * Media type handed to the decoder, when the bytes do not carry one.
   *
   * Only needed for a decoder that cannot sniff the format itself; the platform
   * one can.
   */
  readonly mediaType?: string;
};

/** A decoded image, in the shape {@link ImageResource}'s decoded form needs. */
export interface DecodedImage {
  /** DOM image types only. No renderer texture type is exposed. */
  readonly source: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  /**
   * Width in pixels.
   *
   * Reported by the decoder rather than read back off {@link source}, so a
   * decoder whose output does not expose its own dimensions still works.
   */
  readonly width: number;
  /** Height in pixels. Reported by the decoder, as {@link width} is. */
  readonly height: number;
}

/** How the resolver reaches the platform. Both default to the global. */
export interface EncodedImageResolverOptions {
  /**
   * Fetches a URL. Defaults to the global `fetch`.
   *
   * Supplied from outside so a consumer can add auth headers, a cache policy,
   * or a retry -- none of which this package should have opinions about.
   */
  readonly fetch?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  /**
   * Turns encoded bytes into a decoded image. Defaults to `createImageBitmap`.
   *
   * The one step that genuinely varies by environment: a worker, an SSR
   * context, and a format the platform cannot decode natively each need their
   * own, and a package that hardcoded the browser's would be unusable in all
   * three. It is also what lets this resolver be tested with no network and no
   * real bitmap, which `AGENTS.md` requires -- no test may depend on an asset
   * that is not produced in-process.
   */
  readonly decode?: (bytes: Uint8Array, mediaType: string | undefined) => Promise<DecodedImage>;
}

async function defaultDecode(
  bytes: Uint8Array,
  mediaType: string | undefined,
): Promise<DecodedImage> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("no decoder available; supply `decode` for this environment");
  }
  // A fresh copy of the underlying buffer, because `bytes` may be a view onto a
  // larger one -- a slice of a bundle, or a subarray a caller kept.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], mediaType ? { type: mediaType } : {});
  const bitmap = await createImageBitmap(blob);
  return { source: bitmap, width: bitmap.width, height: bitmap.height };
}

async function bytesFor(
  source: EncodedImageSource,
  signal: AbortSignal,
  fetchImpl: NonNullable<EncodedImageResolverOptions["fetch"]>,
): Promise<Uint8Array> {
  if ("bytes" in source) return source.bytes;
  const response = await fetchImpl(source.url, { signal });
  if (!response.ok) throw new Error(`fetching ${source.url} failed with ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Loads an authored image the store did not create.
 *
 * The counterpart to `inMemoryImageResolver`, which adopts an image a caller
 * already decoded. That one is right for a generated texture and is
 * deliberately zero-dependency; this one is what lets a consumer *declare* a
 * texture and acquire it, with the fetch, the decode, the abort handling and
 * the disposal all owned here instead of repeated at every call site.
 *
 * Nothing about where images live is decided here. A definition names bytes or
 * a URL, and both arrive from a `CatalogSource` the consumer supplies -- which
 * is what makes this work for asset binaries that are never committed.
 */
export function createEncodedImageResolver(
  options: EncodedImageResolverOptions = {},
): ResourceResolver<typeof ENCODED_IMAGE_KIND> {
  const fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
  const decode = options.decode ?? defaultDecode;

  return {
    kind: ENCODED_IMAGE_KIND,
    async load(
      definition: AssetDefinition<typeof ENCODED_IMAGE_KIND>,
      signal: AbortSignal,
    ): Promise<never> {
      const input = definition.source as EncodedImageSource | undefined;
      if (input === undefined || (!("bytes" in input) && !("url" in input))) {
        throw new Error(`"${definition.ref}" declares neither image bytes nor a url`);
      }

      const bytes = await bytesFor(input, signal, fetchImpl);
      signal.throwIfAborted();

      const decoded = await decode(bytes, input.mediaType);

      // The window that matters. `createImageBitmap` takes no signal, so a
      // holder can release while a decode is already in flight -- and the
      // bitmap still arrives, owned by nobody. Dropping it here would leak it
      // exactly as silently as never disposing one, so it is closed before the
      // abort is reported.
      if (signal.aborted) {
        disposeImageResource({ form: "decoded", ...decoded, colorSpace: "srgb" });
        signal.throwIfAborted();
      }

      const image: ImageResource = {
        form: "decoded",
        source: decoded.source,
        width: decoded.width,
        height: decoded.height,
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
}
