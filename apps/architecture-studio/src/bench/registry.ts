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
  /**
   * Accepts any value kind.
   *
   * Only meaningful on an input. An output must always say what it actually
   * produces, or nothing downstream could decide whether to accept it.
   */
  any: "any",
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

// The two filters below are laboratory instruments, not domain logic. They
// exist so a user can put something between two elements and watch the
// difference propagate, which is the bench's whole purpose. Nothing
// authoritative may depend on them: a filter that becomes part of how Grafting
// actually generates terrain belongs in a Rust crate under `libs/domains`,
// like `discretize` already is (root AGENTS.md, DEC-051).

const SMOOTH: BenchNodeKind = Object.freeze({
  id: "filter.smooth",
  title: "Smooth",
  category: "Filters",
  description: "Averages each cell with its neighbours to remove small-scale noise.",
  inputs: Object.freeze([
    Object.freeze({ id: "heightmap", label: "heightmap", dataType: BENCH_DATA_TYPES.heightmap }),
  ]),
  outputs: Object.freeze([
    Object.freeze({ id: "heightmap", label: "heightmap", dataType: BENCH_DATA_TYPES.heightmap }),
  ]),
  params: Object.freeze([
    Object.freeze({
      kind: "integer" as const,
      id: "radius",
      label: "Radius",
      defaultValue: 1,
      min: 0,
      max: 8,
      description: "How many cells in each direction are averaged. Zero passes the input through.",
    }),
  ]),
});

const REMAP: BenchNodeKind = Object.freeze({
  id: "filter.remap",
  title: "Remap",
  category: "Filters",
  description: "Rescales the full range of a heightmap onto a chosen range.",
  inputs: Object.freeze([
    Object.freeze({ id: "heightmap", label: "heightmap", dataType: BENCH_DATA_TYPES.heightmap }),
  ]),
  outputs: Object.freeze([
    Object.freeze({ id: "heightmap", label: "heightmap", dataType: BENCH_DATA_TYPES.heightmap }),
  ]),
  params: Object.freeze([
    Object.freeze({
      kind: "number" as const,
      id: "outputMin",
      label: "Output minimum",
      defaultValue: 0,
      step: 0.05,
      description: "Value the lowest input cell becomes.",
    }),
    Object.freeze({
      kind: "number" as const,
      id: "outputMax",
      label: "Output maximum",
      defaultValue: 1,
      step: 0.05,
      description: "Value the highest input cell becomes.",
    }),
  ]),
});

const VIEWPORT: BenchNodeKind = Object.freeze({
  id: "output.viewport",
  title: "3D viewport",
  category: "Output",
  description: "Renders whatever reaches it in the 3D panel. Connect one to watch a chain change.",
  inputs: Object.freeze([
    Object.freeze({ id: "value", label: "value", dataType: BENCH_DATA_TYPES.any }),
  ]),
  outputs: Object.freeze([]),
  params: Object.freeze([]),
});

/** Every element the bench offers, in menu order. */
export const BENCH_NODE_KINDS: readonly BenchNodeKind[] = Object.freeze([
  PERLIN_HEIGHTMAP,
  SMOOTH,
  REMAP,
  DISCRETIZE,
  VIEWPORT,
]);

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
