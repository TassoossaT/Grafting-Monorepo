/**
 * The stacked grid restated as a *shell*: the boundary between occupied and
 * empty.
 *
 * {@link buildQuadCellGraph} describes the stack faithfully -- every box of
 * every column is a cell -- and that is the right description of the stack. It
 * is the wrong thing to hand a tileset solver, for two reasons that pull in
 * opposite directions:
 *
 * - **Most of the solve is buried.** A column of height four contributes four
 *   cells, three of which no camera will ever see. They are solved, propagated
 *   through, and thrown away.
 * - **The visible surface is the least constrained part of it.** Lateral links
 *   only exist where two columns share a layer, so the top cell of a tall
 *   column facing a short one has *no link* on that face, and an unlinked face
 *   is unconstrained rather than "open to air". The cliff -- the silhouette,
 *   the part that is actually looked at -- is exactly where the solver is
 *   freest to put anything.
 *
 * Both follow from the same mistake: treating emptiness as absence. This module
 * treats it as a thing.
 *
 * # Air is a cell
 *
 * The empty space touching the world is materialised as {@link CELL_AIR} cells,
 * one layer deep. A face that used to be unlinked now links to an air cell, so
 * "this side faces nothing" becomes a constraint the tileset can speak about
 * instead of a silence. Air cells are not decided by the solver -- the caller
 * pins them -- they exist to carry that constraint.
 *
 * # Occupied is a cell only where it meets air
 *
 * An occupied cell with occupied neighbours on all six sides is dropped. It is
 * interior; nothing sees it and nothing it could be changes anything outside
 * it. What survives is the shell: roofs, cliff faces, overhang undersides, and
 * the rim.
 *
 * The result is a graph over the same mesh whose cell count tracks the
 * *surface* rather than the volume, which is the shape a facade tileset wants.
 *
 * # What this deliberately does not do
 *
 * It does not split a cell's faces into separately decided pieces. A cliff face
 * is still a whole cell carrying one module, in the corner-height vocabulary
 * {@link TerrainModule} still uses -- a vocabulary that cannot describe an
 * overhang's underside, and so is the next thing in the way of building freely
 * in three dimensions. This module is the topology that redesign needs
 * underneath it either way.
 */

import { quadAdjacency, normaliseWinding } from "./grid-adjacency.ts";
import type { QuadMesh } from "./irregular-grid.ts";
import type { Occupancy } from "./cell-occupancy.ts";
import { FACES_PER_CELL, FACE_DOWN, FACE_UP, LINK_STRIDE } from "./quad-cell-graph.ts";

export { FACES_PER_CELL, FACE_DOWN, FACE_UP, LINK_STRIDE };

/** A cell holding something. */
export const CELL_SOLID = 1;

/** A cell holding nothing, present only to constrain what it touches. */
export const CELL_AIR = 0;

/** The occupied/empty boundary of a stacked grid, as the solver's cells. */
export interface ShellCellGraph {
  readonly cellCount: number;
  readonly facesPerCell: number;
  /** Adjacency, {@link LINK_STRIDE} numbers each: from, fromFace, to, toFace. */
  readonly links: Uint32Array;
  /** Which quad each cell belongs to, indexed by cell. */
  readonly quadOfCell: Uint32Array;
  /** Which layer each cell sits at, indexed by cell. */
  readonly layerOfCell: Uint32Array;
  /** {@link CELL_SOLID} or {@link CELL_AIR}, indexed by cell. */
  readonly kindOfCell: Uint8Array;
  /**
   * Occupied cells with nothing directly above -- the ones showing a top
   * surface. Under a heightfield this was the top of each column; with a
   * general occupancy every storey of an overhang has one.
   */
  readonly roofCells: Uint32Array;
  /** Every {@link CELL_AIR} cell, for the caller to pin in one pass. */
  readonly airCells: Uint32Array;
  /** How many cells the occupancy holds, shell or interior, for comparison. */
  readonly occupiedCellCount: number;
  /** The cell at `(quad, layer)`, or `null` if the shell does not include it. */
  cellAt(quad: number, layer: number): number | null;
}

/**
 * Builds the shell graph for an occupancy over `mesh`.
 *
 * An empty quad takes part rather than being skipped: its neighbours' sides
 * face air across it, which is the whole point of materialising air.
 *
 * @throws RangeError if the occupancy does not describe every quad of the mesh.
 */
export function buildShellCellGraph(mesh: QuadMesh, occupancy: Occupancy): ShellCellGraph {
  const normalised = normaliseWinding(mesh);
  if (occupancy.quadCount !== normalised.quads.length) {
    throw new RangeError(
      `the occupancy describes ${occupancy.quadCount} quads, but the mesh has ${normalised.quads.length}`,
    );
  }

  const adjacency = quadAdjacency(normalised);

  /** The neighbours of `quad`, as `(slot, neighbour, theirSlot)` triples. */
  const neighboursOf = (quad: number) =>
    (adjacency[quad] ?? []).flatMap((link, slot) =>
      link === null ? [] : [{ slot, neighbour: link.neighbour, theirSlot: link.theirSlot }],
    );

  // A quad's rim slots face air by definition: the map simply stops there. That
  // makes every occupied cell of a rim quad part of the shell, which is correct
  // -- the rim is a cliff like any other.
  const onRim = Array.from(
    { length: occupancy.quadCount },
    (_, quad) => neighboursOf(quad).length < (normalised.quads[quad]?.length ?? 4),
  );

  /**
   * Is `(quad, layer)` empty *as air*?
   *
   * Below layer zero is bedrock rather than sky, so a ground-level cell is not
   * exposed from underneath. See `cell-occupancy.ts` for why.
   */
  const isAir = (quad: number, layer: number): boolean =>
    layer >= 0 && !occupancy.has(quad, layer);

  /** Does `(quad, layer)` have air across at least one of its six faces? */
  const meetsAir = (quad: number, layer: number): boolean =>
    isAir(quad, layer + 1) ||
    (layer > 0 && isAir(quad, layer - 1)) ||
    onRim[quad] === true ||
    neighboursOf(quad).some(({ neighbour }) => isAir(neighbour, layer));

  /** Does empty `(quad, layer)` touch anything occupied? */
  const touchesOccupied = (quad: number, layer: number): boolean =>
    occupancy.has(quad, layer + 1) ||
    occupancy.has(quad, layer - 1) ||
    neighboursOf(quad).some(({ neighbour }) => occupancy.has(neighbour, layer));

  // One layer past the highest occupied one, so a roof always has air above it.
  const layerLimit = occupancy.layerCount + 1;

  // Cells are numbered quad by quad, layer ascending, so a cell id is stable
  // for a given mesh and occupancy -- which is what lets a seed reproduce a map.
  const cellOf = new Map<number, number>();
  const quadOf: number[] = [];
  const layerOf: number[] = [];
  const kindOf: number[] = [];
  for (let quad = 0; quad < occupancy.quadCount; quad += 1) {
    for (let layer = 0; layer < layerLimit; layer += 1) {
      const occupied = occupancy.has(quad, layer);
      if (occupied ? !meetsAir(quad, layer) : !touchesOccupied(quad, layer)) continue;
      cellOf.set(quad * KEY_STRIDE + layer, quadOf.length);
      quadOf.push(quad);
      layerOf.push(layer);
      kindOf.push(occupied ? CELL_SOLID : CELL_AIR);
    }
  }

  const cellAt = (quad: number, layer: number): number | null =>
    cellOf.get(quad * KEY_STRIDE + layer) ?? null;

  const links: number[] = [];

  // Lateral: two quads that touch are linked at every layer both materialised.
  // A layer only one of them reaches is outside the shell entirely, so there is
  // genuinely nothing there to constrain.
  adjacency.forEach((slots, quad) => {
    slots.forEach((link, slot) => {
      // Each undirected adjacency is recorded once, from the lower quad.
      if (link === null || link.neighbour < quad) return;
      for (let layer = 0; layer < layerLimit; layer += 1) {
        const here = cellAt(quad, layer);
        const there = cellAt(link.neighbour, layer);
        if (here === null || there === null) continue;
        links.push(here, slot, there, link.theirSlot);
      }
    });
  });

  // Vertical: within a quad, each cell meets the one above it when the shell
  // kept both. An interior cell below a shell cell leaves its underside silent,
  // which is correct: there is nothing there to disagree with.
  for (let quad = 0; quad < occupancy.quadCount; quad += 1) {
    for (let layer = 0; layer + 1 < layerLimit; layer += 1) {
      const here = cellAt(quad, layer);
      const above = cellAt(quad, layer + 1);
      if (here === null || above === null) continue;
      links.push(here, FACE_UP, above, FACE_DOWN);
    }
  }

  const roofCells: number[] = [];
  const airCells: number[] = [];
  quadOf.forEach((quad, cell) => {
    if (kindOf[cell] === CELL_AIR) airCells.push(cell);
    else if (!occupancy.has(quad, (layerOf[cell] as number) + 1)) roofCells.push(cell);
  });

  return {
    cellCount: quadOf.length,
    facesPerCell: FACES_PER_CELL,
    links: Uint32Array.from(links),
    quadOfCell: Uint32Array.from(quadOf),
    layerOfCell: Uint32Array.from(layerOf),
    kindOfCell: Uint8Array.from(kindOf),
    roofCells: Uint32Array.from(roofCells),
    airCells: Uint32Array.from(airCells),
    occupiedCellCount: occupancy.size,
    cellAt,
  };
}

/**
 * Packs `(cell, module)` assignments into the flat pinning array the wasm
 * boundary takes -- how the caller nails every air cell to its empty module.
 */
export function pinCells(
  cells: Uint32Array | readonly number[],
  moduleIndex: number,
): Uint32Array {
  const flat = new Uint32Array(cells.length * 2);
  Array.from(cells).forEach((cell, index) => {
    flat[index * 2] = cell;
    flat[index * 2 + 1] = moduleIndex;
  });
  return flat;
}

/** Spreads `(quad, layer)` into one integer key. Layers never approach this. */
const KEY_STRIDE = 1 << 20;
