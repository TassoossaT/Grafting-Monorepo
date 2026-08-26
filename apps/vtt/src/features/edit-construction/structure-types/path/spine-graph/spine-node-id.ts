/**
 * Node identity for a spine control point, addressed by the graph itself
 * rather than by a linear position along one run.
 *
 * **Why not `station-node-id.ts`'s scheme.** `stationNodeId` carries
 * `(operationId, station, across)` because a station-major sweep is a single
 * ordered line, and every node on it has exactly one well-defined "how far
 * along, how far across." A curve-graph spine drops that assumption on
 * purpose: a real junction is one control node with three or more curve
 * edges leaving it, not a linear position any one run can claim as its own
 * station N. Trying to keep `station`/`across` here would force every
 * junction back into the same "borrow a node from whichever run got there
 * first" trick `weldedSpineAt` already has to play in `path-cloud.ts` --
 * exactly the fragility this graph exists to remove.
 *
 * **What the id keeps instead.** Only `operationId` (which edit minted the
 * node) and an `index` (which point of that edit it was) survive. Neither is
 * ownership: when a later curve ends *on* an existing control node, the
 * committing edit reuses that node's own id directly rather than minting a
 * fresh one and relying on a position lookup to weld them after the fact --
 * a junction is one shared id from the moment it is drawn, not two ids two
 * runs each believe are "theirs" until something reconciles them. The
 * `operationId`/`index` pair only has to be unique and deterministic at
 * mint time; nothing downstream parses it to learn what kind of node it is.
 */

const MARKER = "spine";
const PATTERN = /^spine:(.*):(\d+)$/;

/** One control node's id, as the parts it is built from. */
export interface SpineControlNodeAddress {
  /** The edit that minted this node. Provenance only, never ownership. */
  readonly operationId: string;
  /** Which point of that edit this was. */
  readonly index: number;
}

export function spineControlNodeId(operationId: string, index: number): string {
  return `${MARKER}:${operationId}:${index}`;
}

/** The address inside `id`, or `undefined` for an id no spine edit minted. */
export function parseSpineControlNodeId(id: string): SpineControlNodeAddress | undefined {
  const match = PATTERN.exec(id);
  if (match === null) return undefined;
  const [, operationId, index] = match;
  if (operationId === undefined || index === undefined) return undefined;
  return { operationId, index: Number(index) };
}

export function isSpineControlNodeId(id: string): boolean {
  return parseSpineControlNodeId(id) !== undefined;
}
