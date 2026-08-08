import type { EvaluationPreview } from "./evaluation-client.ts";
import type { BenchValue } from "./evaluators.ts";

// Flattens any value kind onto one zero-to-one scale so a single renderer can
// show the output of any element. Normalizing per value is deliberate: it makes
// the *shape* of two results comparable even when their ranges differ, which is
// what a user is looking at when they add or bypass a filter.

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
 * Projects one element result into something the heightfield renderer accepts.
 *
 * @param value - Any value produced by an element.
 * @returns A grid normalized to zero-to-one, or `null` for a value that has no
 * grid to draw, such as the single number a control produces.
 */
export function toEvaluationPreview(value: BenchValue): EvaluationPreview | null {
  if (value.dataType === "number") return null;
  // A grid off the lattice and a triangle soup have no raster to normalise.
  // Drawing them needs a viewport that renders geometry rather than a
  // heightfield; until there is one, they evaluate but show nothing, which is
  // better than projecting them into a picture that misrepresents them.
  if (value.dataType === "quadmesh" || value.dataType === "mesh") return null;
  if (value.dataType === "levels") {
    // Levels are already an ordered scale, so their declared count is the
    // range rather than whatever indices happen to be present. Otherwise a map
    // that used only the lower bands would stretch to look like a full one.
    const span = Math.max(value.levelCount - 1, 1);
    const values = new Float32Array(value.indices.length);
    for (let index = 0; index < value.indices.length; index += 1) {
      values[index] = value.indices[index]! / span;
    }
    return { width: value.width, height: value.height, values, dataType: value.dataType };
  }

  const { minimum, maximum } = extent(value.values);
  return {
    width: value.width,
    height: value.height,
    values: normalize(value.values, minimum, maximum),
    dataType: value.dataType,
  };
}
