/**
 * Node identity for anything built station by station along a line: which
 * cross-section a node belongs to, and where across that cross-section it
 * sits.
 *
 * **Why identity and not geometry.** A later edit needs to answer "what else
 * belongs to this station, and which of those lie further out than the node
 * I grabbed". Both are facts about how the thing was *built*. Reading them
 * back off positions works only until the first drag moves those positions,
 * and fails outright for an interior that is not a neat grid -- a honeycomb
 * or an irregular trail bed, where following edges outward from the spine
 * reaches the whole product and connectivity gives no direction at all.
 * Carrying the answer in the id keeps it true no matter what the geometry
 * later becomes, and is how this repo already distinguishes a wall's own
 * corners (`...:c3:bottom`).
 *
 * `across` is signed **relative to the spine**, which is slot 0. That single
 * choice is what makes "outward" arithmetic rather than a lookup: same sign,
 * greater magnitude. The outermost node's outward set is empty by
 * construction, so a contour needs no special case anywhere.
 */

/** One node of a station-major sweep, as the parts its id is built from. */
export interface StationNodeAddress {
  /** The operation that minted it -- the corridor this node belongs to. */
  readonly operationId: string;
  /** Which cross-section along the line. */
  readonly station: number;
  /** Signed slot across the cross-section; `0` is the spine. */
  readonly across: number;
}

/**
 * A station may be fractional. A junction lands wherever two runs happen to
 * cross, which is between stations far more often than on one, and the node
 * inserted there belongs to the crossed run's own spine. Numbering it `3.5`
 * keeps it in the chain and in the right order, where a fresh integer would
 * collide and a separate id scheme would drop it out of the chain entirely.
 */
const PATTERN = /^(.*):s(\d+(?:\.\d+)?):a(-?\d+)$/;

export function stationNodeId(operationId: string, station: number, across: number): string {
  return `${operationId}:s${station}:a${across}`;
}

/** The address inside `id`, or `undefined` for an id no sweep minted. */
export function parseStationNodeId(id: string): StationNodeAddress | undefined {
  const match = PATTERN.exec(id);
  if (match === null) return undefined;
  const [, operationId, station, across] = match;
  if (operationId === undefined || station === undefined || across === undefined) return undefined;
  return { operationId, station: Number(station), across: Number(across) };
}

/** Whether `id` names the travel line itself rather than anything beside it. */
export function isSpineNode(id: string): boolean {
  return parseStationNodeId(id)?.across === 0;
}

/**
 * Whether `candidate` should follow `moved` when `moved` is dragged: same
 * corridor, same station, and further from the spine on the same side.
 *
 * The spine carries its whole cross-section, a node partway out carries only
 * what lies beyond it, and the outermost carries nothing -- one rule, no
 * per-slot cases. Expressed as "further out" rather than as a walk from
 * neighbour to neighbour because the two agree wherever a walk is even
 * possible, and this keeps agreeing when the interior is not a grid.
 */
export function followsOutward(moved: StationNodeAddress, candidate: StationNodeAddress): boolean {
  if (candidate.operationId !== moved.operationId) return false;
  if (candidate.station !== moved.station) return false;
  if (candidate.across === moved.across) return false;
  if (moved.across === 0) return true;
  return Math.sign(candidate.across) === Math.sign(moved.across)
    && Math.abs(candidate.across) > Math.abs(moved.across);
}
