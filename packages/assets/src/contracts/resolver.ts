import type { AssetDefinition } from "./definition.js";
import type { ResourceKind, ResourceOf } from "./ref.js";

/**
 * Turns a declaration into a loaded resource, for one kind.
 *
 * Registration is the whole integration surface for content this package knows
 * nothing about, and it is the third use of the same pattern in this repository
 * -- `@grafting/render-3d`'s `VisualRegistry` and the VTT's covering registry
 * being the other two. Godot arrives at the same shape (`ResourceLoader` as a
 * facade over registered per-format loaders), and Bevy at a near-identical one.
 *
 * A parametric box, a decoded `.glb`, a canvas-generated texture and a
 * procedurally generated mesh are four resolvers behind one opaque ref. Nothing
 * upstream of a resolver knows which it got.
 */
export interface ResourceResolver<TKind extends ResourceKind = ResourceKind> {
  /** The kind this resolver claims. One resolver per kind. */
  readonly kind: TKind;
  /**
   * Produces the resource. Rejecting is an ordinary outcome, not a crash: the
   * store records the failure and the caller falls back.
   *
   * `signal` aborts when the last holder releases before the load finishes.
   */
  load(definition: AssetDefinition<TKind>, signal: AbortSignal): Promise<ResourceOf<TKind>>;
  /**
   * Releases anything {@link load} allocated outside the JS heap.
   *
   * The single most important method in this package. WebGL and `ImageBitmap`
   * resources are not garbage collected, and disposal bugs are subtle enough
   * that three.js shipped one for years -- `Texture.dispose()` does not close
   * the underlying `ImageBitmap`, so textures decoded from `.glb` leak unless
   * the caller also closes the bitmap. Routing every disposal through one owner
   * is what makes such a fix land in one place instead of every call site.
   */
  dispose?(resource: ResourceOf<TKind>): void;
  /**
   * Reports the resource's memory cost, when the resolver can know it honestly.
   *
   * Optional because only the resolver can tell: a decoded image's true cost is
   * its uncompressed pixel buffer, not its file size, and a guess in the store
   * would be worse than an absent number.
   */
  sizeOf?(resource: ResourceOf<TKind>): number;
}

/**
 * Supplies the definitions available in one environment.
 *
 * Without this, "where do the bytes live" would simply move up a level into
 * "where does the *list* live", and be hardcoded there instead. A manifest
 * fetched over HTTP, a scan of a development folder, a read from IndexedDB and
 * a fixed array in a test are four implementations of this one method; the
 * package ships none of them.
 */
export interface CatalogSource {
  /** Identifies this source in diagnostics. */
  readonly id: string;
  /** Everything this source declares. */
  list(signal: AbortSignal): Promise<readonly AssetDefinition[]>;
}
