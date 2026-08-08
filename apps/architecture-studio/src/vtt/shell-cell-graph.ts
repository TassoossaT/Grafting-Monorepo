/**
 * The stacked grid restated as a *shell*: the boundary between solid and air.
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
 * The space above a column is materialised as {@link CELL_AIR} cells, one layer
 * at a time, but only where they touch solid. A face that used to be unlinked
 * now links to an air cell, so "this side faces nothing" becomes a constraint
 * the tileset can speak about instead of a silence. Air cells are not decided
 * by the solver -- the caller pins them -- they exist to carry that constraint.
 *
 * # Solid is a cell only where it meets air
 *
 * A solid box with solid on all six sides is dropped. It is interior; nothing
 * sees it and nothing it could be changes anything outside it. What survives is
 * the shell: tops, cliff faces, and the rim.
 *
 * The result is a graph over the same mesh whose cell count tracks the
 * *surface* rather than the volume, which is the shape a facade tileset wants.
 *
 * # What this deliberately does not do
 *
 * It does not split a cell's faces into separately decided pieces. A cliff face
 * is still a whole cell carrying one module, in the corner-height vocabulary
 * {@link TerrainModule} already uses. A true per-face facade tileset is a
 * content redesign, and a larger one; this module is the topology it would need
 * underneath either way.
 */

import { quadAdjacency, normaliseWinding } from "./grid-adjacency.ts";
import type { QuadMesh } from "./irregular-grid.ts";
import { FACES_PER_CELL, FACE_DOWN, FACE_UP, LINK_STRIDE } from "./quad-cell-graph.ts";

export { FACES_PER_CELL, FACE_DOWN, FACE_UP, LINK_STRIDE };

/** A cell holding terrain. */
export const CELL_SOLID = 1;

/** A cell holding nothing, present only to constrain the solid it touches. */
export const CELL_AIR = 0;

/** The stacked grid's solid/air boundary, as the solver's cells and links. */
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
  /** Solid cells at the top of their column -- the ones with a visible top. */
  readonly topCells: Uint32Array;
  /** Every {@link CELL_AIR} cell, for the caller to pin in one pass. */
  readonly airCells: Uint32Array;
  /** How many boxes the *unreduced* stack would have held, for comparison. */
  readonly volumeCellCount: number;
  /** The cell at `(quad, layer)`, or `null` if the shell does not include it. */
  cellAt(quad: number, layer: number): number | null;
}

/**
 * Builds the shell graph for a stacked quad grid.
 *
 * `solidPerQuad[q]` is how many boxes of terrain quad `q` holds; `0` is a hole,
 * and still takes part -- its neighbours' sides face air across it, which is
 * the whole point of materialising air.
 *
 * @throws RangeError if `solidPerQuad` does not describe every quad, or holds a
 * value that is not a non-negative integer. A silently wrong stack produces a
 * plausible-looking map that is wrong, which is worse than a refusal.
 */
export function buildShellCellGraph(
  mesh: QuadMesh,
  solidPerQuad: readonly number[],
): ShellCellGraph {
  const normalised = normaliseWinding(mesh);
  if (solidPerQuad.length !== normalised.quads.length) {
    throw new RangeError(
      `solidPerQuad describes ${solidPerQuad.length} quads, but the mesh has ${normalised.quads.length}`,
    );
  }
  solidPerQuad.forEach((solid, quad) => {
    if (!Number.isInteger(solid) || solid < 0) {
      throw new RangeError(`quad ${quad} has a solid height of ${solid}, which is not a count`);
    }
  });

  const adjacency = quadAdjacency(normalised);

  /** The neighbours of `quad`, as `(slot, neighbour, theirSlot)` triples. */
  const neighboursOf = (quad: number) =>
    (adjacency[quad] ?? []).flatMap((link, slot) =>
      link === null ? [] : [{ slot, neighbour: link.neighbour, theirSlot: link.theirSlot }],
    );

  // A quad's rim slots face air by definition: the map simply stops there. That
  // makes every solid cell of a rim quad part of the shell, which is correct --
  // the rim is a cliff like any other.
  const onRim = solidPerQuad.map(
    (_, quad) => neighboursOf(quad).length < (normalised.quads[quad]?.length ?? 4),
  );

  const tallestNeighbour = solidPerQuad.map((_, quad) =>
    neighboursOf(quad).reduce(
      (tallest, { neighbour }) => Math.max(tallest, solidPerQuad[neighbour] as number),
      0,
    ),
  );

  // Air is materialised from a column's own top up to the tallest neighbour's
  // top, plus the one layer resting on this column. Above that, air touches
  // only air, and constrains nothing.
  const airTop = solidPerQuad.map((solid, quad) =>
    Math.max(tallestNeighbour[quad] as number, solid > 0 ? solid + 1 : solid),
  );

  /** Is the solid box `(quad, layer)` part of the shell rather than interior? */
  const solidIsShell = (quad: number, layer: number): boolean => {
    const solid = solidPerQuad[quad] as number;
    if (layer === solid - 1) return true; // air directly above
    if (onRim[quad] === true) return true; // the map ends beside it
    return neighboursOf(quad).some(({ neighbour }) => (solidPerQuad[neighbour] as number) <= layer);
  };

  const included = solidPerQuad.map((solid, quad) => {
    const layers: { layer: number; kind: number }[] = [];
    for (let layer = 0; layer < solid; layer += 1) {
      if (solidIsShell(quad, layer)) layers.push({ layer, kind: CELL_SOLID });
    }
    for (let layer = solid; layer < (airTop[quad] as number); layer += 1) {
      layers.push({ layer, kind: CELL_AIR });
    }
    return layers;
  });

  // Cells are numbered quad by quad, layer ascending, so a cell id is stable
  // for a given mesh and stack -- which is what lets a seed reproduce a map.
  const cellOf = new Map<number, number>();
  const quadOf: number[] = [];
  const layerOf: number[] = [];
  const kindOf: number[] = [];
  included.forEach((layers, quad) => {
    for (const { layer, kind } of layers) {
      cellOf.set(quad * KEY_STRIDE + layer, quadOf.length);
      quadOf.push(quad);
      layerOf.push(layer);
      kindOf.push(kind);
    }
  });

  const cellAt = (quad: number, layer: number): number | null =>
    cellOf.get(quad * KEY_STRIDE + layer) ?? null;

  const links: number[] = [];

  // Lateral: two quads that touch are linked at every layer both materialised.
  // A layer only one of them reaches produces no link -- but with air present
  // that now means "outside the shell entirely", not "a step down".
  adjacency.forEach((slots, quad) => {
    slots.forEach((link, slot) => {
      // Each undirected adjacency is recorded once, from the lower quad.
      if (link === null || link.neighbour < quad) return;
      const top = Math.max(airTop[quad] as number, airTop[link.neighbour] as number);
      for (let layer = 0; layer < top; layer += 1) {
        const here = cellAt(quad, layer);
        const there = cellAt(link.neighbour, layer);
        if (here === null || there === null) continue;
        links.push(here, slot, there, link.theirSlot);
      }
    });
  });

  // Vertical: within a quad, each cell meets the one above it when the shell
  // kept both. An interior box below a shell box leaves its underside silent,
  // which is correct: there is nothing there to disagree with.
  included.forEach((layers, quad) => {
    for (const { layer } of layers) {
      const here = cellAt(quad, layer);
      const above = cellAt(quad, layer + 1);
      if (here === null || above === null) continue;
      links.push(here, FACE_UP, above, FACE_DOWN);
    }
  });

  const topCells: number[] = [];
  const airCells: number[] = [];
  quadOf.forEach((quad, cell) => {
    if (kindOf[cell] === CELL_AIR) airCells.push(cell);
    else if (layerOf[cell] === (solidPerQuad[quad] as number) - 1) topCells.push(cell);
  });

  return {
    cellCount: quadOf.length,
    facesPerCell: FACES_PER_CELL,
    links: Uint32Array.from(links),
    quadOfCell: Uint32Array.from(quadOf),
    layerOfCell: Uint32Array.from(layerOf),
    kindOfCell: Uint8Array.from(kindOf),
    topCells: Uint32Array.from(topCells),
    airCells: Uint32Array.from(airCells),
    volumeCellCount: solidPerQuad.reduce((total, solid) => total + solid, 0),
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
