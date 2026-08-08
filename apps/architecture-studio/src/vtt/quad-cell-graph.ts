/**
 * Stage 4: describing the stacked irregular grid as a solver cell graph.
 *
 * The solver (`@grafting/procgen-tileset-wfc`) knows nothing about grids. It
 * takes cells, and links saying "face `f` of cell `a` meets face `g` of cell
 * `b`". This module is the translation, and it is the reason the solver could
 * stay generic: everything irregular about the grid is absorbed here.
 *
 * # A cell is a quad *and a layer*
 *
 * Stage 2 gave each quad a discrete level, so the terrain is a stack of boxes,
 * not a surface. A cell is therefore one box -- `(quad, layer)` -- and a quad
 * with level 3 contributes four cells. Anything else would force a module to
 * encode its own height, which is exactly the continuous problem the discrete
 * levels were introduced to avoid.
 *
 * # Six faces, of which only four rotate
 *
 * Faces 0-3 are the quad's four edge slots in cyclic order, the same slots
 * {@link quadAdjacency} produces. Faces 4 and 5 are up and down. That split is
 * what the solver's rotation cycle relies on: a module may be turned about the
 * vertical axis, permuting faces 0-3, while up stays up. Passing `[0, 1, 2, 3]`
 * as the rotation cycle is what makes that true, and passing anything
 * containing 4 or 5 would let a module land on its side.
 *
 * # What an unlinked face means, and does not
 *
 * A face with no link -- the grid's outer boundary, or a neighbour that does
 * not reach this layer -- is left *unconstrained*, not "open to air". The
 * solver has nothing to say about it, so a module presenting a solid socket
 * there is as acceptable as one presenting an open socket. Enclosing the map
 * needs either pinned border cells or a socket convention the tileset applies
 * itself; {@link openFaces} exists so a caller can do the former without
 * rediscovering which faces those are.
 */

import { quadAdjacency, normaliseWinding } from "./grid-adjacency.ts";
import type { QuadMesh } from "./irregular-grid.ts";

/** Faces per cell: four lateral slots, then up and down. */
export const FACES_PER_CELL = 6;

/** The lateral faces, in the cyclic order a rotation walks them. */
export const LATERAL_FACES: readonly number[] = [0, 1, 2, 3];

/** The face pointing at the cell above. */
export const FACE_UP = 4;

/** The face pointing at the cell below. */
export const FACE_DOWN = 5;

/** Numbers per link in the flat array, matching the crate's `LINK_STRIDE`. */
export const LINK_STRIDE = 4;

/** A `(cell, face)` pair with nothing across it. */
export interface OpenFace {
  readonly cell: number;
  readonly face: number;
}

/** The grid, restated as the solver's cells and links. */
export interface QuadCellGraph {
  readonly cellCount: number;
  readonly facesPerCell: number;
  /** Adjacency, {@link LINK_STRIDE} numbers each: from, fromFace, to, toFace. */
  readonly links: Uint32Array;
  /** Which quad each cell belongs to, indexed by cell. */
  readonly quadOfCell: Uint32Array;
  /** Which layer each cell sits at, indexed by cell. */
  readonly layerOfCell: Uint32Array;
  /** The cell at `(quad, layer)`, or `null` if that box does not exist. */
  cellAt(quad: number, layer: number): number | null;
}

/**
 * Builds the cell graph for a stacked quad grid.
 *
 * `layersPerQuad[q]` is how many boxes quad `q` contributes; `0` leaves that
 * quad out entirely, which is how a hole or a water cell is expressed without
 * a special case.
 *
 * The mesh is wound-normalised first, because slot order has to turn the same
 * way on every quad for a rotation to mean anything. That is idempotent, so
 * passing an already-normalised mesh costs nothing but a pass.
 *
 * @throws RangeError if `layersPerQuad` does not describe every quad, or holds
 * a value that is not a non-negative integer. A silently wrong stack produces
 * a plausible-looking map that is wrong, which is worse than a refusal.
 */
export function buildQuadCellGraph(
  mesh: QuadMesh,
  layersPerQuad: readonly number[],
): QuadCellGraph {
  const normalised = normaliseWinding(mesh);
  if (layersPerQuad.length !== normalised.quads.length) {
    throw new RangeError(
      `layersPerQuad describes ${layersPerQuad.length} quads, but the mesh has ${normalised.quads.length}`,
    );
  }
  layersPerQuad.forEach((layers, quad) => {
    if (!Number.isInteger(layers) || layers < 0) {
      throw new RangeError(`quad ${quad} has a layer count of ${layers}, which is not a count`);
    }
  });

  // Cells are numbered quad by quad, layer ascending, so a cell id is stable
  // for a given mesh and stack -- which is what lets a seed reproduce a map.
  const offsets = new Uint32Array(layersPerQuad.length + 1);
  layersPerQuad.forEach((layers, quad) => {
    offsets[quad + 1] = (offsets[quad] as number) + layers;
  });
  const cellCount = offsets[layersPerQuad.length] as number;

  const quadOfCell = new Uint32Array(cellCount);
  const layerOfCell = new Uint32Array(cellCount);
  layersPerQuad.forEach((layers, quad) => {
    for (let layer = 0; layer < layers; layer += 1) {
      const cell = (offsets[quad] as number) + layer;
      quadOfCell[cell] = quad;
      layerOfCell[cell] = layer;
    }
  });

  const cellAt = (quad: number, layer: number): number | null => {
    const layers = layersPerQuad[quad];
    if (layers === undefined || layer < 0 || layer >= layers) return null;
    return (offsets[quad] as number) + layer;
  };

  const links: number[] = [];

  // Lateral: two quads that touch are linked at every layer they share. A
  // layer one of them does not reach produces no link, which is how a step
  // between levels becomes an exposed face rather than a bad adjacency.
  const adjacency = quadAdjacency(normalised);
  adjacency.forEach((slots, quad) => {
    slots.forEach((link, slot) => {
      // Each undirected adjacency is recorded once, from the lower quad.
      if (link === null || link.neighbour < quad) return;
      const shared = Math.min(
        layersPerQuad[quad] as number,
        layersPerQuad[link.neighbour] as number,
      );
      for (let layer = 0; layer < shared; layer += 1) {
        links.push(
          cellAt(quad, layer) as number,
          slot,
          cellAt(link.neighbour, layer) as number,
          link.theirSlot,
        );
      }
    });
  });

  // Vertical: within a quad, each box meets the one above it.
  layersPerQuad.forEach((layers, quad) => {
    for (let layer = 0; layer + 1 < layers; layer += 1) {
      links.push(cellAt(quad, layer) as number, FACE_UP, cellAt(quad, layer + 1) as number, FACE_DOWN);
    }
  });

  return {
    cellCount,
    facesPerCell: FACES_PER_CELL,
    links: Uint32Array.from(links),
    quadOfCell,
    layerOfCell,
    cellAt,
  };
}

/**
 * Every face with nothing across it: the grid's rim, the exposed sides of a
 * step, the top of each stack and the underside of the bottom layer.
 *
 * These are the faces the solver is silent about (see this module's header),
 * so a caller that wants the map enclosed pins them here rather than inferring
 * them from the geometry a second time.
 */
export function openFaces(graph: QuadCellGraph): readonly OpenFace[] {
  const linked = new Set<number>();
  for (let index = 0; index < graph.links.length; index += LINK_STRIDE) {
    linked.add((graph.links[index] as number) * FACES_PER_CELL + (graph.links[index + 1] as number));
    linked.add(
      (graph.links[index + 2] as number) * FACES_PER_CELL + (graph.links[index + 3] as number),
    );
  }

  const open: OpenFace[] = [];
  for (let cell = 0; cell < graph.cellCount; cell += 1) {
    for (let face = 0; face < FACES_PER_CELL; face += 1) {
      if (!linked.has(cell * FACES_PER_CELL + face)) open.push({ cell, face });
    }
  }
  return open;
}
