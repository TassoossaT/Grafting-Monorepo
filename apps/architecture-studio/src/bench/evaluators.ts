import { BENCH_DATA_TYPES, BENCH_NODE_KINDS } from "./registry.ts";
import { paramIdFromPort, type BenchParamValue, type BenchParamValues } from "./node-kind.ts";
import { buildIrregularQuadGrid, type QuadMesh } from "../vtt/irregular-grid.ts";
import { buildStackedTerrain, sampleCellValues } from "../vtt/stacked-terrain.ts";
import { buildTransitionTerrain } from "../vtt/transition-shapes.ts";

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

/** A single scalar travelling from a control into a parameter. */
export interface NumberValue {
  readonly dataType: "number";
  readonly value: number;
}

/**
 * An irregular quad grid.
 *
 * Carried whole rather than rasterised: the grid's value is precisely that it
 * is not on a lattice, and a raster would throw away the adjacency every later
 * stage is built on.
 */
export interface QuadMeshValue {
  readonly dataType: "quadmesh";
  readonly mesh: QuadMesh;
}

/** Renderable geometry, ready for a viewport. */
export interface MeshValue {
  readonly dataType: "mesh";
  /** Flat `xyz` triples. */
  readonly positions: Float32Array;
  /** Triangles indexing them. */
  readonly indices: Uint32Array;
}

/** Any value that may travel along a connection. */
export type BenchValue =
  | HeightmapValue
  | LevelsValue
  | MeshValue
  | NumberValue
  | QuadMeshValue;

/** The Rust entry points the laboratory elements are built on. */
export interface BenchWasm {
  /** Generates a Perlin heightmap. */
  generateHeightmap(
    width: number,
    height: number,
    seed: number,
    scale: number,
    originX: number,
    originY: number,
  ): Float32Array;
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

const expectQuadMesh = (value: BenchValue | undefined, port: string): QuadMeshValue => {
  if (value === undefined || value.dataType !== "quadmesh") {
    throw new Error(`Bench input ${port} expected a grid`);
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

  evaluators.set("grid.irregular", (_inputs, params) => ({
    dataType: "quadmesh" as const,
    mesh: buildIrregularQuadGrid({
      trianglesPerSide: asNumber(params.trianglesPerSide),
      triangleSide: asNumber(params.triangleSide),
      seed: asNumber(params.seed),
    }),
  }));

  evaluators.set("terrain.stack", (inputs, params) => {
    const grid = expectQuadMesh(inputs.grid, "grid").mesh;
    const field = expectHeightmap(inputs.heightmap, "heightmap");

    // The cells are irregular and the heightmap is not, so nothing lines a
    // cell centre up with a sample; the sampling is bilinear so two adjacent
    // cells cannot land on the same sample and flatten a step that exists.
    const sampled = sampleCellValues(grid, field);
    // Quantised by the Rust crate rather than here: the repository has one
    // authoritative binning implementation and this is not it.
    const levels = wasm.discretize(sampled, asNumber(params.levels));

    const terrain = buildStackedTerrain(grid, levels, {
      levelHeight: asNumber(params.levelHeight),
      baseHeight: asNumber(params.baseHeight),
    });

    // Tops and walls are one mesh here. They are separate in the trial only
    // because it shades them differently; the value kind carries geometry.
    const indices = new Uint32Array(terrain.topIndices.length + terrain.wallIndices.length);
    indices.set(terrain.topIndices, 0);
    indices.set(terrain.wallIndices, terrain.topIndices.length);
    return { dataType: "mesh" as const, positions: terrain.positions, indices };
  });

  evaluators.set("terrain.transitions", (inputs, params) => {
    const grid = expectQuadMesh(inputs.grid, "grid").mesh;
    const field = expectHeightmap(inputs.heightmap, "heightmap");

    const sampled = sampleCellValues(grid, field);
    const levels = wasm.discretize(sampled, asNumber(params.levels));

    const terrain = buildTransitionTerrain(grid, levels, {
      levelHeight: asNumber(params.levelHeight),
      baseHeight: asNumber(params.baseHeight),
    });

    const indices = new Uint32Array(
      terrain.topIndices.length + terrain.sideIndices.length + terrain.skirtIndices.length,
    );
    indices.set(terrain.topIndices, 0);
    indices.set(terrain.sideIndices, terrain.topIndices.length);
    indices.set(terrain.skirtIndices, terrain.topIndices.length + terrain.sideIndices.length);
    return { dataType: "mesh" as const, positions: terrain.positions, indices };
  });

  evaluators.set("mesh.procedural", (inputs, params) => {
    const quadmeshInput = inputs.grid?.dataType === "quadmesh" ? inputs.grid.mesh : undefined;
    const field = inputs.heightmap?.dataType === "heightmap" ? inputs.heightmap : undefined;
    const deformationXY = asNumber(params.deformationXY);
    const deformationZ = asNumber(params.deformationZ);
    const vertexShiftX = asNumber(params.vertexShiftX);
    const vertexShiftY = asNumber(params.vertexShiftY);
    const vertexShiftZ = asNumber(params.vertexShiftZ);

    if (quadmeshInput) {
      // Connects with irregular-quad-grid (grid.irregular)!
      const { vertices, quads } = quadmeshInput;
      const vertCount = vertices.length;
      const positions = new Float32Array(vertCount * 3);

      for (let i = 0; i < vertCount; i++) {
        const v = vertices[i]!;
        let gx = v.x;
        let gy = v.y;
        let gz = 0;

        if (deformationXY > 0) {
          gx += Math.sin(gx * 1.3 + gy * 0.7) * 0.2 * deformationXY;
          gy += Math.cos(gx * 0.9 - gy * 1.1) * 0.2 * deformationXY;
        }

        if (field) {
          const sampleX = Math.min(field.width - 1, Math.max(0, Math.floor(((gx + 2) / 4) * field.width)));
          const sampleY = Math.min(field.height - 1, Math.max(0, Math.floor(((gy + 2) / 4) * field.height)));
          gz += field.values[sampleY * field.width + sampleX]! * 1.5;
        } else if (deformationZ > 0) {
          gz += (Math.sin(gx * 0.8) + Math.cos(gy * 0.8)) * 0.8 * deformationZ;
        }

        // Apply vertex shifts
        if (i === vertCount - 1) {
          gx += vertexShiftX;
          gy += vertexShiftY;
          gz += vertexShiftZ;
        }

        positions[i * 3] = gx;
        positions[i * 3 + 1] = gz;
        positions[i * 3 + 2] = gy;
      }

      const indicesList: number[] = [];
      for (const quad of quads) {
        const [a, b, c, d] = quad;
        indicesList.push(a, c, b, a, d, c);
      }



      return {
        dataType: "mesh" as const,
        positions,
        indices: new Uint32Array(indicesList),
      };
    }


    const width = field ? field.width : 4;
    const height = field ? field.height : 4;

    const vertCols = width + 1;
    const vertRows = height + 1;
    const layerVertCount = vertCols * vertRows;
    const positions = new Float32Array(layerVertCount * 2 * 3);

    for (let l = 0; l <= 1; l++) {
      const zBase = l * 1.5;
      for (let y = 0; y <= height; y++) {
        for (let x = 0; x <= width; x++) {
          const idx = (l * layerVertCount + y * vertCols + x) * 3;
          let gx = (x - width / 2) * 1.2;
          let gy = (y - height / 2) * 1.2;
          let gz = zBase;

          const cornerFactorX = x / width;
          const cornerFactorY = y / height;
          gx += cornerFactorX * cornerFactorY * vertexShiftX;
          gy += cornerFactorX * cornerFactorY * vertexShiftY;
          if (l > 0) gz += cornerFactorX * cornerFactorY * vertexShiftZ;

          if (deformationXY > 0 && x > 0 && x < width && y > 0 && y < height) {
            gx += Math.sin(x * 1.3 + y * 0.7) * 0.4 * deformationXY;
            gy += Math.cos(x * 0.9 - y * 1.1) * 0.4 * deformationXY;
          }

          if (field) {
            const fieldIdx = y * width + x;
            if (fieldIdx < field.values.length) {
              gz += field.values[fieldIdx]! * 1.5;
            }
          } else if (deformationZ > 0) {
            gz += (Math.sin(x * 0.8) + Math.cos(y * 0.8)) * 0.8 * deformationZ;
          }

          positions[idx] = gx;
          positions[idx + 1] = gz;
          positions[idx + 2] = gy;
        }
      }
    }

    const indicesList: number[] = [];
    const nlOffset = layerVertCount;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v4 = nlOffset + y * vertCols + x;
        const v5 = nlOffset + y * vertCols + (x + 1);
        const v6 = nlOffset + (y + 1) * vertCols + (x + 1);
        const v7 = nlOffset + (y + 1) * vertCols + x;
        indicesList.push(v4, v6, v5, v4, v7, v6);
      }
    }

    return {
      dataType: "mesh" as const,
      positions,
      indices: new Uint32Array(indicesList),
    };
  });



  evaluators.set("heightmap.perlin", (_inputs, params) => {
    const width = asNumber(params.width);
    const height = asNumber(params.height);
    return {
      dataType: BENCH_DATA_TYPES.heightmap,
      width,
      height,
      values: wasm.generateHeightmap(width, height, asNumber(params.seed), asNumber(params.scale), 0, 0),
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

  evaluators.set("control.number", (_inputs, params) => ({
    dataType: BENCH_DATA_TYPES.number,
    value: asNumber(params.value),
  } as NumberValue));

  evaluators.set("control.choice", (_inputs, params) => ({
    dataType: BENCH_DATA_TYPES.number,
    value: asNumber(params.choice),
  } as NumberValue));

  // A connected parameter wins over the value typed on the node. Wrapping here
  // rather than inside each evaluator means an element never has to know that a
  // parameter can arrive over a wire.
  const wrapped = new Map<string, BenchEvaluator>();
  for (const [id, evaluate] of evaluators) {
    wrapped.set(id, (inputs, params) => evaluate(inputs, mergeParamInputs(params, inputs)));
  }
  return wrapped;
}

/**
 * Applies values that arrived over parameter ports on top of a node's own.
 *
 * @param params - Values held by the node instance.
 * @param inputs - Everything feeding the node, parameter ports included.
 * @returns Parameters with connected values overriding typed ones.
 */
export function mergeParamInputs(
  params: BenchParamValues,
  inputs: Readonly<Record<string, BenchValue>>,
): BenchParamValues {
  let merged: Record<string, BenchParamValue> | null = null;
  for (const [portId, value] of Object.entries(inputs)) {
    const paramId = paramIdFromPort(portId);
    if (paramId === null || value.dataType !== "number") continue;
    merged ??= { ...params };
    merged[paramId] = value.value;
  }
  return merged === null ? params : Object.freeze(merged);
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
