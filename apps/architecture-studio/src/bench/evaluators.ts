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

  return evaluators;
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
