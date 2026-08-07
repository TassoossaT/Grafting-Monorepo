import type { VisualDefinition, VisualDescriptor } from "../contracts/visual.js";

/** Parameters for the {@link heightfieldVisual} kind. */
export interface HeightfieldParams {
  /** Sample count along the X axis. */
  readonly width: number;
  /** Sample count along the Z axis. */
  readonly depth: number;
  /** Row-major elevation samples, `width * depth` of them. */
  readonly values: Float32Array;
  /** World-space span of the grid on both axes. Defaults to `20` square. */
  readonly size?: number;
  /** Multiplier applied to each sample before it becomes a vertex height. Defaults to `1`. */
  readonly elevationScale?: number;
  /** Surface color. Defaults to white, so the caller's palette decides. */
  readonly color?: number;
  /** Whether facets are shaded flat. Defaults to `true`. */
  readonly flatShading?: boolean;
}

/**
 * A replaceable default for the most common surface shape: a regular grid of
 * elevation samples.
 *
 * It is here because a grid of heights is genuinely generic — it is terrain,
 * but it is equally a fluid surface, a deformation field, or a heatmap — and
 * not because the engine has any opinion about what a caller draws. A product
 * that wants different shading registers its own kind under a different name
 * and this one costs it nothing.
 */
export const heightfieldVisual: VisualDefinition<HeightfieldParams> = {
  kind: "heightfield",

  describe(params: HeightfieldParams): VisualDescriptor {
    const size = params.size ?? 20;
    return {
      geometry: {
        shape: "heightfield",
        field: {
          width: params.width,
          depth: params.depth,
          values: params.values,
          size: { x: size, z: size },
          elevationScale: params.elevationScale ?? 1,
        },
      },
      material: {
        surface: "lit",
        color: params.color ?? 0xffffff,
        flatShading: params.flatShading ?? true,
        doubleSided: true,
      },
    };
  },

  equals(a: HeightfieldParams, b: HeightfieldParams): boolean {
    // Sample data is compared by reference on purpose. A field is large enough
    // that an elementwise comparison every frame would cost more than the
    // rebuild it is trying to avoid; producing a new array is the caller's
    // signal that the data actually changed.
    return (
      a.values === b.values &&
      a.width === b.width &&
      a.depth === b.depth &&
      a.size === b.size &&
      a.elevationScale === b.elevationScale &&
      a.color === b.color &&
      a.flatShading === b.flatShading
    );
  },
};
