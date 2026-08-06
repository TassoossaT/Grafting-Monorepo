import { BENCH_DATA_TYPES, BENCH_NODE_KINDS } from "./registry.ts";
import type { BenchParamValues } from "./node-kind.ts";

// What an element *does*, kept apart from what it *is* (`registry.ts`). The
// Wasm entry points arrive by injection rather than by import so this module
// stays pure and testable outside a browser; only the worker supplies the real
// ones. `evaluatorCoverage` guards the two halves against drifting apart.

/** A continuous grid of floating-point heights. */
export interface HeightmapValue {
  readonly dataType: "heightmap";
  readonly width: number;
  readonly height: number;
  readonly values: Float32Array;
}

/** A grid of discrete level indices. */
export interface LevelsValue {
  readonly dataType: "levels";
  readonly width: number;
  readonly height: number;
  readonly levelCount: number;
  readonly indices: Int32Array;
}

/** Any value that may travel along a connection. */
export type BenchValue = HeightmapValue | LevelsValue;

/** The Rust entry points the laboratory elements are built on. */
export interface BenchWasm {
  /** Generates a Perlin heightmap. */
  generateHeightmap(width: number, height: number, seed: number, scale: number): Float32Array;
  /** Collapses continuous values into discrete level indices. */
  discretize(values: Float32Array, levels: number): Int32Array;
}

/** Runs one element. */
export type BenchEvaluator = (
  inputs: Readonly<Record<string, BenchValue>>,
  params: BenchParamValues,
) => BenchValue;

const asNumber = (value: unknown): number => (typeof value === "number" ? value : Number(value));

const expectHeightmap = (value: BenchValue | undefined, port: string): HeightmapValue => {
  if (value === undefined || value.dataType !== "heightmap") {
    throw new Error(`Bench input ${port} expected a heightmap`);
  }
  return value;
};

/**
 * Builds the evaluator for every registered element.
 *
 * @param wasm - Rust entry points, injected so this module never imports them.
 * @returns Element identity to the function that runs it.
 */
export function createBenchEvaluators(wasm: BenchWasm): ReadonlyMap<string, BenchEvaluator> {
  const evaluators = new Map<string, BenchEvaluator>();

  evaluators.set("heightmap.perlin", (_inputs, params) => {
    const width = asNumber(params.width);
    const height = asNumber(params.height);
    return {
      dataType: BENCH_DATA_TYPES.heightmap,
      width,
      height,
      values: wasm.generateHeightmap(width, height, asNumber(params.seed), asNumber(params.scale)),
    } as HeightmapValue;
  });

  evaluators.set("terrain.discretize", (inputs, params) => {
    const source = expectHeightmap(inputs.heightmap, "heightmap");
    const levelCount = asNumber(params.levels);
    return {
      dataType: BENCH_DATA_TYPES.levels,
      width: source.width,
      height: source.height,
      levelCount,
      indices: wasm.discretize(source.values, levelCount),
    } as LevelsValue;
  });

  // Laboratory instruments, deliberately written here in TypeScript rather
  // than in Rust: they exist so a user can drop something between two elements
  // and watch the difference propagate. Nothing authoritative may depend on
  // them (see the note in `registry.ts`).

  evaluators.set("filter.smooth", (inputs, params) => {
    const source = expectHeightmap(inputs.heightmap, "heightmap");
    const radius = Math.trunc(asNumber(params.radius));
    if (radius <= 0) return source;
    return {
      ...source,
      values: boxBlur(source.values, source.width, source.height, radius),
    };
  });

  evaluators.set("filter.remap", (inputs, params) => {
    const source = expectHeightmap(inputs.heightmap, "heightmap");
    const outputMin = asNumber(params.outputMin);
    const outputMax = asNumber(params.outputMax);
    return { ...source, values: remap(source.values, outputMin, outputMax) };
  });

  evaluators.set("output.viewport", (inputs) => {
    const value = inputs.value;
    if (value === undefined) throw new Error("Bench input value expected a connected element");
    // A viewport observes; it does not transform. Passing the value straight
    // through means the preview shows exactly what reached it.
    return value;
  });

  return evaluators;
}

/**
 * Averages every cell with the square of neighbours around it.
 *
 * Separable passes would be faster, but a bench grid is small and one readable
 * pass is easier to trust than two clever ones. Edges clamp rather than wrap,
 * so a map does not acquire features from its opposite side.
 */
function boxBlur(
  source: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const result = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + offsetY));
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const sampleX = Math.min(width - 1, Math.max(0, x + offsetX));
          total += source[sampleY * width + sampleX]!;
          count += 1;
        }
      }
      result[y * width + x] = total / count;
    }
  }
  return result;
}

/**
 * Rescales a grid's full range onto the requested one.
 *
 * A flat input has no range to rescale, so every cell takes the lower bound
 * rather than dividing by zero.
 */
function remap(source: Float32Array, outputMin: number, outputMax: number): Float32Array {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < source.length; index += 1) {
    const value = source[index]!;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  const span = maximum - minimum;
  const result = new Float32Array(source.length);
  if (span <= 0) return result.fill(outputMin);
  const scale = (outputMax - outputMin) / span;
  for (let index = 0; index < source.length; index += 1) {
    result[index] = outputMin + (source[index]! - minimum) * scale;
  }
  return result;
}

/**
 * Reports which registered elements have no evaluator, and vice versa.
 *
 * An element that renders but cannot run, or an evaluator for an element the
 * menu never offers, are both silent failures; this makes them assertable.
 *
 * @param evaluators - Result of {@link createBenchEvaluators}.
 * @returns The two sets of identities that appear on only one side.
 */
export function evaluatorCoverage(evaluators: ReadonlyMap<string, BenchEvaluator>): {
  readonly withoutEvaluator: readonly string[];
  readonly withoutKind: readonly string[];
} {
  const declared = new Set(BENCH_NODE_KINDS.map((kind) => kind.id));
  return Object.freeze({
    withoutEvaluator: Object.freeze([...declared].filter((id) => !evaluators.has(id))),
    withoutKind: Object.freeze([...evaluators.keys()].filter((id) => !declared.has(id))),
  });
}
