/**
 * How something is drawn, described as data.
 *
 * The engine has no notion of what a scene item *is*. It knows only that an
 * item names a registered visual kind and carries parameters for it. Whether
 * that kind means a character marker, a wall segment, a volume of water, or a
 * spell effect is decided entirely outside this package, by whoever registers
 * the kind — including a separate package that this one never imports.
 *
 * Descriptors are plain data on purpose. A renderer-specific object would make
 * the extension point a vendor boundary, forcing every consumer that wants a
 * new shape to import the renderer. Data keeps the renderer private (DEC-049)
 * and keeps the engine replaceable underneath.
 */

/** Packed vertex data for a caller-built shape. */
export interface MeshData {
  /** Flat `xyz` triples, three floats per vertex. */
  readonly positions: Float32Array;
  /** Optional flat `xyz` normal triples. Computed from faces when omitted. */
  readonly normals?: Float32Array;
  /** Optional flat `uv` pairs, two floats per vertex. */
  readonly uvs?: Float32Array;
  /** Optional triangle indices. Positions are read sequentially when omitted. */
  readonly indices?: Uint16Array | Uint32Array;
}

/** A regular grid of elevation samples, the shape a terrain or a fluid surface takes. */
export interface HeightfieldData {
  /** Sample count along the X axis. */
  readonly width: number;
  /** Sample count along the Z axis. */
  readonly depth: number;
  /** Row-major elevation samples, `width * depth` of them. */
  readonly values: Float32Array;
  /** World-space span of the grid on both axes. Defaults to `width`/`depth`. */
  readonly size?: { readonly x: number; readonly z: number };
  /** Multiplier applied to each sample before it becomes a vertex height. Defaults to `1`. */
  readonly elevationScale?: number;
}

/** The shape half of a visual. */
export type GeometryDescriptor =
  | { readonly shape: "plane"; readonly width: number; readonly depth: number; readonly segments?: number }
  | { readonly shape: "box"; readonly width: number; readonly height: number; readonly depth: number }
  | { readonly shape: "sphere"; readonly radius: number; readonly segments?: number }
  | { readonly shape: "cylinder"; readonly radius: number; readonly height: number; readonly segments?: number }
  | { readonly shape: "heightfield"; readonly field: HeightfieldData }
  | { readonly shape: "mesh"; readonly data: MeshData };

/** An image source a material may sample. DOM types only; no renderer texture type is exposed. */
export type TextureSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

/** The appearance half of a visual. */
export type MaterialDescriptor =
  | {
      /** Responds to scene lighting. */
      readonly surface: "lit";
      readonly color?: number;
      readonly opacity?: number;
      readonly metalness?: number;
      readonly roughness?: number;
      readonly flatShading?: boolean;
      readonly doubleSided?: boolean;
      readonly texture?: TextureSource;
    }
  | {
      /** Ignores scene lighting. The right choice for overlays, grids, and markers. */
      readonly surface: "unlit";
      readonly color?: number;
      readonly opacity?: number;
      readonly doubleSided?: boolean;
      readonly texture?: TextureSource;
    }
  | {
      /** Draws edges rather than faces. */
      readonly surface: "line";
      readonly color?: number;
      readonly opacity?: number;
    }
  | {
      /**
       * Draws each of the geometry's vertices as a point, filling nothing.
       *
       * Pairs with *any* geometry, which is the useful part: the same
       * heightfield or mesh a caller already has can be drawn as a cloud of
       * points instead of a solid surface, with no second copy of the data.
       *
       * Points convey silhouette and volume while being structurally unable to
       * carry surface detail. That makes this the right primitive whenever
       * something must be shown to exist without being shown in full — a
       * partially-known space, a scan, a preview of data not yet resolved.
       */
      readonly surface: "points";
      readonly color?: number;
      readonly opacity?: number;
      /** Point size. In world units when attenuated, in pixels when not. Defaults to `1`. */
      readonly size?: number;
      /** Whether points shrink with distance. Defaults to `true`. */
      readonly sizeAttenuation?: boolean;
      /** Sprite applied to each point, for soft or shaped points rather than squares. */
      readonly texture?: TextureSource;
    };

/** A complete description of how to draw one item. */
export interface VisualDescriptor {
  readonly geometry: GeometryDescriptor;
  readonly material: MaterialDescriptor;
  /**
   * Whether the item should be considered for pointer picking. Defaults to
   * `true`. Terrain under a fog layer, or a purely decorative overlay, sets
   * this to `false` so it never intercepts a click.
   */
  readonly pickable?: boolean;
}

/**
 * A named, externally-supplied way of turning parameters into a drawable
 * description.
 *
 * Registering a kind is the entire integration surface for anything the engine
 * does not know about. Two kinds that happen to draw the same way share the
 * same descriptor and cost the engine nothing extra; two kinds that mean
 * completely different things to the product are still just two entries here.
 */
export interface VisualDefinition<TParams = unknown> {
  /** Stable name items reference. Must be unique within a registry. */
  readonly kind: string;
  /** Produces the drawable description for a set of parameters. */
  describe(params: TParams): VisualDescriptor;
  /**
   * Optional cheap comparison used to skip rebuilding an unchanged item.
   *
   * Without it the engine falls back to reference equality on the parameters,
   * which is correct but conservative: a caller that rebuilds an equivalent
   * parameter object every frame would rebuild geometry every frame.
   */
  equals?(a: TParams, b: TParams): boolean;
}

/** An item's reference to a registered kind, plus that kind's parameters. */
export interface VisualRef<TParams = unknown> {
  readonly kind: string;
  readonly params: TParams;
}

/** Lookup of visual kinds, owned by the caller and shared by every scene. */
export interface VisualRegistry {
  /** Registers a kind. Throws when the name is already taken. */
  register<TParams>(definition: VisualDefinition<TParams>): void;
  /** Returns the definition for a kind, or `undefined` when it was never registered. */
  get(kind: string): VisualDefinition<never> | undefined;
  /** Every registered kind name, in registration order. */
  kinds(): readonly string[];
}
