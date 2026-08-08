import type { BenchValue } from "./evaluators.ts";

// How a value kind is shown, declared by the value kind rather than known by
// the viewport. The bench already works this way for elements: a `BenchNodeKind`
// is a declaration and the menu, ports and controls derive from it (ADR-0019).
// Previews were the exception -- the viewport knew, in its own code, that a
// result is a raster -- so every new value kind meant editing UI. It does not
// any more.
//
// The registration is split by a boundary that is real: `project` runs in the
// evaluation worker, the renderer runs on the main thread, and only data
// crosses between them. That is why a value kind declares a *projection* into
// a small set of **forms** rather than a draw function -- a function does not
// survive `postMessage`. It is also the honest limit of this design: a value
// kind that cannot be reduced to transferable arrays does not fit, and should
// say so by returning `null` instead of being smuggled through.

/**
 * A preview form is what a renderer knows how to draw.
 *
 * Deliberately coarser than the value kinds: `mesh` and `quadmesh` are
 * different values that both project to geometry, and one renderer serves
 * both. A form is added only when something genuinely cannot be drawn by an
 * existing one.
 */
export type PreviewForm = "raster" | "geometry";

/** A grid of samples normalized to zero-to-one. */
export interface RasterPreview {
  readonly form: "raster";
  /** The value kind this was projected from. */
  readonly dataType: string;
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}

/** Triangles in world space. */
export interface GeometryPreview {
  readonly form: "geometry";
  /** The value kind this was projected from. */
  readonly dataType: string;
  /** Flat `xyz` triples. */
  readonly positions: Float32Array;
  /** Triangles indexing them. */
  readonly indices: Uint32Array;
}

/** Anything the viewport can be handed. */
export type EvaluationPreview = RasterPreview | GeometryPreview;

/** One value kind's declaration of how it is shown. */
export interface PreviewKind {
  /** The value kind this projects. */
  readonly dataType: string;
  /**
   * Reduces a value to something drawable, or `null` when it has nothing to
   * show. Returning `null` is a real answer -- a single scalar has no picture,
   * and inventing one would be worse than an empty frame.
   */
  project(value: BenchValue): EvaluationPreview | null;
}

/**
 * Rescales a range onto zero-to-one.
 *
 * A flat input has no range to stretch, so it renders at the bottom of the
 * scale rather than dividing by zero.
 */
function normalize(source: ArrayLike<number>, minimum: number, maximum: number): Float32Array {
  const span = maximum - minimum;
  const values = new Float32Array(source.length);
  if (span <= 0) return values;
  for (let index = 0; index < source.length; index += 1) {
    values[index] = (source[index]! - minimum) / span;
  }
  return values;
}

function extent(source: ArrayLike<number>): { minimum: number; maximum: number } {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index]!;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return { minimum, maximum };
}

/**
 * Every value kind's preview declaration.
 *
 * Normalizing a raster per value is deliberate: it makes the *shape* of two
 * results comparable even when their ranges differ, which is what a user is
 * looking at when they add or bypass a filter.
 */
export const PREVIEW_KINDS: readonly PreviewKind[] = Object.freeze([
  Object.freeze({
    dataType: "heightmap",
    project(value: BenchValue) {
      if (value.dataType !== "heightmap") return null;
      const { minimum, maximum } = extent(value.values);
      return {
        form: "raster" as const,
        dataType: value.dataType,
        width: value.width,
        height: value.height,
        values: normalize(value.values, minimum, maximum),
      };
    },
  }),
  Object.freeze({
    dataType: "levels",
    project(value: BenchValue) {
      if (value.dataType !== "levels") return null;
      // Levels are already an ordered scale, so their declared count is the
      // range rather than whatever indices happen to be present. Otherwise a
      // map that used only the lower bands would stretch to look like a full
      // one.
      const span = Math.max(value.levelCount - 1, 1);
      const values = new Float32Array(value.indices.length);
      for (let index = 0; index < value.indices.length; index += 1) {
        values[index] = value.indices[index]! / span;
      }
      return {
        form: "raster" as const,
        dataType: value.dataType,
        width: value.width,
        height: value.height,
        values,
      };
    },
  }),
  Object.freeze({
    dataType: "mesh",
    project(value: BenchValue) {
      if (value.dataType !== "mesh") return null;
      return {
        form: "geometry" as const,
        dataType: value.dataType,
        positions: value.positions,
        indices: value.indices,
      };
    },
  }),
  Object.freeze({
    dataType: "quadmesh",
    project(value: BenchValue) {
      if (value.dataType !== "quadmesh") return null;
      // Laid flat, since a bare grid has no elevation yet. Each quad becomes
      // two triangles across its own diagonal; that the two halves of a
      // non-planar quad would disagree does not arise here, because every
      // vertex is at y = 0.
      const { vertices, quads } = value.mesh;
      const positions = new Float32Array(vertices.length * 3);
      vertices.forEach((vertex, index) => {
        positions[index * 3] = vertex.x;
        positions[index * 3 + 2] = vertex.y;
      });
      const indices = new Uint32Array(quads.length * 6);
      quads.forEach((quad, index) => {
        const [a, b, c, d] = quad as unknown as [number, number, number, number];
        indices.set([a, b, c, a, c, d], index * 6);
      });
      return { form: "geometry" as const, dataType: value.dataType, positions, indices };
    },
  }),
]);

const BY_DATA_TYPE: ReadonlyMap<string, PreviewKind> = new Map(
  PREVIEW_KINDS.map((kind) => [kind.dataType, kind]),
);

/**
 * Projects one element result into something a viewport can draw.
 *
 * @param value - Any value produced by an element.
 * @returns A preview, or `null` for a value kind that declares none and for one
 * that declares no preview at all -- an unregistered kind shows nothing rather
 * than throwing, since a missing picture is a gap and not a broken graph.
 */
export function toEvaluationPreview(value: BenchValue): EvaluationPreview | null {
  return BY_DATA_TYPE.get(value.dataType)?.project(value) ?? null;
}

/**
 * The buffers a preview owns, so the worker can hand them over instead of
 * copying them.
 *
 * Kept beside the forms rather than in the worker: a new form that forgot to
 * list its buffers would silently start copying whole grids per frame, which
 * is exactly the kind of regression nobody notices until it is slow.
 */
export function previewTransferables(preview: EvaluationPreview): Transferable[] {
  return preview.form === "raster"
    ? [preview.values.buffer]
    : [preview.positions.buffer, preview.indices.buffer];
}
