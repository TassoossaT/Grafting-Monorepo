import type { PathKind } from "./tool-types.ts";

/**
 * A corridor is one committed run of path, and its id is where the subtype
 * that built it survives.
 *
 * Every path collapses to the single `path` surface type on purpose, so the
 * surface itself cannot say whether it came from a road, a trail or a bridge
 * deck. Something has to, or a later regeneration has no recipe to re-run and
 * a junction cannot tell what it is joining. The id is that something --
 * carried, not inferred, exactly as a station and its slot are.
 *
 * The marker is appended rather than mixed in so `parseStationNodeId` keeps
 * working unchanged: a corridor id is still just the opaque prefix a node id
 * is built on.
 */

const MARKER = "#";

export function pathCorridorId(operationId: string, kind: PathKind): string {
  return `${operationId}${MARKER}${kind}`;
}

/** The subtype `corridorId` was built from, or `undefined` if it carries none. */
export function pathSubtypeOf(corridorId: string): PathKind | undefined {
  const at = corridorId.lastIndexOf(MARKER);
  if (at < 0) return undefined;
  const kind = corridorId.slice(at + MARKER.length);
  return kind === "trail" || kind === "street" || kind === "road" || kind === "bridge"
    ? kind
    : undefined;
}
