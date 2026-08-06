import type { BenchNodeKind } from "./node-kind.ts";

// Every laboratory element is declared here and nowhere else. Adding one is a
// registration: the menu, the parameter controls, the ports, and duplication
// all derive from the declaration, so no bench UI file changes (ADR-0019).

/**
 * Opaque value kinds exchanged between elements.
 *
 * These are product vocabulary, not canvas concepts — `@grafting/ui` carries
 * the string through and never reads it.
 */
export const BENCH_DATA_TYPES = Object.freeze({
  /** A continuous grid of floating-point heights. */
  heightmap: "heightmap",
  /** A grid of discrete level indices. */
  levels: "levels",
});

const GRID_PARAMS = Object.freeze([
  Object.freeze({
    kind: "integer" as const,
    id: "width",
    label: "Width",
    defaultValue: 64,
    min: 8,
    max: 512,
    description: "Number of cells along the horizontal axis.",
  }),
  Object.freeze({
    kind: "integer" as const,
    id: "height",
    label: "Height",
    defaultValue: 64,
    min: 8,
    max: 512,
    description: "Number of cells along the vertical axis.",
  }),
]);

const PERLIN_HEIGHTMAP: BenchNodeKind = Object.freeze({
  id: "heightmap.perlin",
  title: "Perlin heightmap",
  category: "Generation",
  description: "Generates a continuous heightmap from Perlin noise in Rust.",
  inputs: Object.freeze([]),
  outputs: Object.freeze([
    Object.freeze({ id: "heightmap", label: "heightmap", dataType: BENCH_DATA_TYPES.heightmap }),
  ]),
  params: Object.freeze([
    ...GRID_PARAMS,
    Object.freeze({
      kind: "seed" as const,
      id: "seed",
      label: "Seed",
      defaultValue: 1,
      description: "Fixes the generated pattern; the same seed always yields the same map.",
    }),
    Object.freeze({
      kind: "number" as const,
      id: "scale",
      label: "Scale",
      defaultValue: 0.12,
      min: 0.01,
      max: 1,
      step: 0.01,
      description: "Noise frequency. Lower values produce broader features.",
    }),
  ]),
});

const DISCRETIZE: BenchNodeKind = Object.freeze({
  id: "terrain.discretize",
  title: "Discretize",
  category: "Terrain",
  description: "Collapses a continuous heightmap into a fixed number of discrete levels.",
  inputs: Object.freeze([
    Object.freeze({ id: "heightmap", label: "heightmap", dataType: BENCH_DATA_TYPES.heightmap }),
  ]),
  outputs: Object.freeze([
    Object.freeze({ id: "levels", label: "levels", dataType: BENCH_DATA_TYPES.levels }),
  ]),
  params: Object.freeze([
    Object.freeze({
      kind: "integer" as const,
      id: "levels",
      label: "Levels",
      defaultValue: 6,
      min: 2,
      max: 64,
      description: "How many discrete bands the continuous range collapses into.",
    }),
  ]),
});

/** Every element the bench offers, in menu order. */
export const BENCH_NODE_KINDS: readonly BenchNodeKind[] = Object.freeze([PERLIN_HEIGHTMAP, DISCRETIZE]);

const BY_ID: ReadonlyMap<string, BenchNodeKind> = new Map(
  BENCH_NODE_KINDS.map((kind) => [kind.id, kind]),
);

/**
 * Looks up a registered element.
 *
 * @param id - Element identity stored on a node instance.
 * @returns The declaration.
 * @throws If no element is registered under that identity.
 */
export function findNodeKind(id: string): BenchNodeKind {
  const kind = BY_ID.get(id);
  if (kind === undefined) throw new Error(`Bench element is not registered: ${id}`);
  return kind;
}

/**
 * Groups the registered elements for the menu.
 *
 * @returns Categories in first-registered order, each with its elements.
 */
export function nodeKindsByCategory(): readonly {
  readonly category: string;
  readonly kinds: readonly BenchNodeKind[];
}[] {
  const grouped = new Map<string, BenchNodeKind[]>();
  for (const kind of BENCH_NODE_KINDS) {
    const existing = grouped.get(kind.category);
    if (existing === undefined) grouped.set(kind.category, [kind]);
    else existing.push(kind);
  }
  return [...grouped].map(([category, kinds]) => Object.freeze({ category, kinds: Object.freeze(kinds) }));
}
