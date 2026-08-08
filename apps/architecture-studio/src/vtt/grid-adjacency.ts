/**
 * Stage 4 groundwork: the adjacency a WFC solver needs from the irregular
 * quad grid, and the direction encoding that makes it usable.
 *
 * A constraint solver in the `ghx_proc_gen` family does not consume "cell A
 * touches cell B". It consumes a fixed set of *directions*, and requires one
 * invariant of the grid it is given:
 *
 *   if the neighbour of `n` in direction `d` is `m`,
 *   then the neighbour of `m` in direction `opposite(d)` must be `n`.
 *
 * On a regular grid that is free: `d` is a compass bearing and `opposite` is
 * the reversed bearing. On our grid it is not free, and the obvious encoding
 * fails -- see {@link compassAssignment}. The encoding that does work is
 * {@link slotPairDirection}.
 */

import type { QuadMesh, Quad } from "./irregular-grid.ts";

/** One side of a quad: which of its four edge slots, and who is across it. */
export interface SlotLink {
  readonly neighbour: number;
  readonly theirSlot: number;
}

/** Per quad, the four edge slots in cyclic order; `null` where the grid ends. */
export type QuadAdjacency = readonly (readonly (SlotLink | null)[])[];

/** Signed area doubled; positive when the quad is wound counter-clockwise. */
function signedArea(mesh: QuadMesh, quad: Quad): number {
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = mesh.vertices[quad[i] as number];
    const b = mesh.vertices[quad[((i + 1) % 4)] as number];
    if (a === undefined || b === undefined) continue;
    total += a.x * b.y - b.x * a.y;
  }
  return total;
}

/**
 * Rewinds clockwise quads so every quad lists its corners counter-clockwise.
 *
 * Slot arithmetic below is only meaningful if "slot + 1" turns the same way
 * everywhere, so this is a precondition of the analysis, not tidiness.
 */
export function normaliseWinding(mesh: QuadMesh): QuadMesh {
  const quads = mesh.quads.map((quad) => {
    if (signedArea(mesh, quad) >= 0) return quad;
    return [quad[3], quad[2], quad[1], quad[0]] as Quad;
  });
  return { vertices: mesh.vertices, quads };
}

/**
 * Builds the dual adjacency: for each quad and each of its four edge slots,
 * the quad across that edge and the slot it occupies over there.
 *
 * Edges used by more than two quads are dropped rather than guessed at; the
 * grid builder is not expected to produce them, and silently picking two of
 * three would corrupt the solver's neighbour table.
 */
export function quadAdjacency(mesh: QuadMesh): QuadAdjacency {
  const uses = new Map<string, { quad: number; slot: number }[]>();
  mesh.quads.forEach((quad, index) => {
    for (let slot = 0; slot < 4; slot += 1) {
      const a = quad[slot] as number;
      const b = quad[(slot + 1) % 4] as number;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const bucket = uses.get(key);
      if (bucket === undefined) uses.set(key, [{ quad: index, slot }]);
      else bucket.push({ quad: index, slot });
    }
  });

  const adjacency: (SlotLink | null)[][] = mesh.quads.map(() => [null, null, null, null]);
  for (const bucket of uses.values()) {
    if (bucket.length !== 2) continue;
    const [x, y] = bucket as [{ quad: number; slot: number }, { quad: number; slot: number }];
    (adjacency[x.quad] as (SlotLink | null)[])[x.slot] = { neighbour: y.quad, theirSlot: y.slot };
    (adjacency[y.quad] as (SlotLink | null)[])[y.slot] = { neighbour: x.quad, theirSlot: x.slot };
  }
  return adjacency;
}

/** How many lateral directions the slot-pair encoding uses. */
export const LATERAL_DIRECTION_COUNT = 16;

/** The direction index for "leaving by my slot `mine`, arriving at their slot `theirs`". */
export function slotPairDirection(mine: number, theirs: number): number {
  return mine * 4 + theirs;
}

/** Reverses a slot-pair direction, which is exactly swapping the two slots. */
export function oppositeSlotPair(direction: number): number {
  return slotPairDirection(direction % 4, Math.floor(direction / 4));
}

/**
 * The solver-facing neighbour table under the slot-pair encoding.
 *
 * `table[quad][direction]` is the neighbour index, or `null`. Most entries are
 * `null` -- a quad has four neighbours spread over sixteen directions -- which
 * the solver permits, since a missing neighbour is already how it represents a
 * grid border.
 */
export function slotPairNeighbours(adjacency: QuadAdjacency): readonly (readonly (number | null)[])[] {
  return adjacency.map((slots) => {
    const directions: (number | null)[] = new Array(LATERAL_DIRECTION_COUNT).fill(null);
    slots.forEach((link, slot) => {
      if (link === null) return;
      directions[slotPairDirection(slot, link.theirSlot)] = link.neighbour;
    });
    return directions;
  });
}

/** Counts places where the solver's opposite-direction invariant is broken. */
export function opposabilityViolations(
  table: readonly (readonly (number | null)[])[],
): number {
  let violations = 0;
  table.forEach((directions, quad) => {
    directions.forEach((neighbour, direction) => {
      if (neighbour === null) return;
      if (table[neighbour]?.[oppositeSlotPair(direction)] !== quad) violations += 1;
    });
  });
  return violations;
}

/** The outcome of trying to label slots as four global compass directions. */
export interface CompassAssignment {
  /** Per quad, the rotation taking its local slots to global directions. */
  readonly turns: readonly number[];
  /** Shared edges no rotation can satisfy. Zero means the labelling exists. */
  readonly contradictions: number;
}

/**
 * Attempts the *obvious* encoding: four global directions, `opposite(d)` being
 * `(d + 2) % 4`, each quad free to rotate its slot labels.
 *
 * With winding normalised, rotation is the only freedom left -- a reflection
 * would reverse the winding -- so this search is complete, and a non-zero
 * `contradictions` proves no such labelling exists rather than merely that
 * this routine failed to find one. The obstruction is vertices of valence
 * other than four, which an irregular grid has by construction.
 */
export function compassAssignment(mesh: QuadMesh): CompassAssignment {
  const adjacency = quadAdjacency(normaliseWinding(mesh));
  const turns: (number | null)[] = adjacency.map(() => null);
  let contradictions = 0;

  for (let start = 0; start < turns.length; start += 1) {
    if (turns[start] !== null) continue;
    turns[start] = 0;
    const queue = [start];
    while (queue.length > 0) {
      const quad = queue.shift() as number;
      (adjacency[quad] as readonly (SlotLink | null)[]).forEach((link, slot) => {
        if (link === null) return;
        const want = ((turns[quad] as number) + slot - link.theirSlot + 2 + 8) % 4;
        if (turns[link.neighbour] === null) {
          turns[link.neighbour] = want;
          queue.push(link.neighbour);
        } else if (turns[link.neighbour] !== want) {
          contradictions += 1;
        }
      });
    }
  }

  // Each contradictory edge is met from both of its quads.
  return { turns: turns.map((turn) => turn ?? 0), contradictions: contradictions / 2 };
}
