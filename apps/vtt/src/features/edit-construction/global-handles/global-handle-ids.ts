/**
 * The handles that stand for a whole structure rather than one of its
 * points, whatever the structure is built from -- a spine, a cloud of
 * regions:
 *
 * - pivot: moves it;
 * - rotate: turns it round its pivot;
 * - height: raises or lowers it (a spine: its far end);
 * - turns: winds a spiral on or back;
 * - radius: widens or narrows a spiral round its centre;
 * - origin, destination: move one end of a structure that runs between two
 *   ends, connecting it where it lands and disconnecting it where it left;
 * - originHeight, destinationHeight: raise or lower that one end -- how
 *   steeply the structure climbs;
 * - side, corner: stand just outside one side or corner of the structure
 *   and push that part -- the part itself is never grabbed, so it stays
 *   free to build against;
 * - foot, top: an upright structure's post -- where it stands, and how high
 *   that side rises;
 * - detach: clicked, the structure lets go of whatever it is joined to;
 * - rise: how high a structure grown from its base rises above it; brought
 *   down to nothing, the structure is gone;
 * - slope: how steeply one of its faces climbs; brought down to nothing,
 *   the face stands upright instead;
 * - seam: how steeply the two faces meeting along a seam climb, together;
 * - insert: from the middle of one side, a new corner pulled out of it.
 *
 * Which of them a structure shows is its type's declaration
 * (`StructureTypeDefinition.globalHandles`). Every one is named after the
 * structure's lowest node id, so it stays the same handle through any edit
 * that keeps that node; none is a graph node. This module is the only place
 * their ids are made or read.
 */
export type GlobalHandleKind = "pivot" | "rotate" | "height" | "turns" | "radius" | "origin" | "destination" | "originHeight" | "destinationHeight" | "side" | "corner" | "foot" | "top" | "detach" | "rise" | "slope" | "seam" | "insert";

const PREFIX: Readonly<Record<GlobalHandleKind, string>> = {
  pivot: "structure-pivot:", rotate: "structure-rotate:", height: "structure-height:", turns: "structure-turns:", radius: "structure-radius:",
  origin: "structure-origin:", destination: "structure-destination:",
  originHeight: "structure-origin-height:", destinationHeight: "structure-destination-height:",
  side: "structure-side:", corner: "structure-corner:",
  foot: "structure-foot:", top: "structure-top:", detach: "structure-detach:",
  rise: "structure-rise:", slope: "structure-slope:", seam: "structure-seam:", insert: "structure-insert:",
};
const KINDS = Object.keys(PREFIX) as readonly GlobalHandleKind[];

export const globalHandleId = (kind: GlobalHandleKind, anchorNodeId: string): string => `${PREFIX[kind]}${anchorNodeId}`;

/** Which global handle `id` names, and after which node; `undefined` for anything else. */
export function globalHandleOf(id: string): { readonly kind: GlobalHandleKind; readonly nodeId: string } | undefined {
  const kind = KINDS.find((candidate) => id.startsWith(PREFIX[candidate]));
  return kind && { kind, nodeId: id.slice(PREFIX[kind].length) };
}
