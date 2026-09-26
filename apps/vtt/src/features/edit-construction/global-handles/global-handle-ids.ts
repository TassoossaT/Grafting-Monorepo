/**
 * The handles that stand for a whole structure rather than one of its
 * points, whatever the structure is built from -- a spine, a cloud of
 * regions:
 *
 * - pivot: moves it;
 * - rotate: turns it round its pivot;
 * - height: raises or lowers it (a spine: its far end);
 * - turns: winds a spiral on or back.
 *
 * Which of them a structure shows is its type's declaration
 * (`StructureTypeDefinition.globalHandles`). Every one is named after the
 * structure's lowest node id, so it stays the same handle through any edit
 * that keeps that node; none is a graph node. This module is the only place
 * their ids are made or read.
 */
export type GlobalHandleKind = "pivot" | "rotate" | "height" | "turns";

const PREFIX: Readonly<Record<GlobalHandleKind, string>> = { pivot: "structure-pivot:", rotate: "structure-rotate:", height: "structure-height:", turns: "structure-turns:" };
const KINDS = Object.keys(PREFIX) as readonly GlobalHandleKind[];

export const globalHandleId = (kind: GlobalHandleKind, anchorNodeId: string): string => `${PREFIX[kind]}${anchorNodeId}`;

/** Which global handle `id` names, and after which node; `undefined` for anything else. */
export function globalHandleOf(id: string): { readonly kind: GlobalHandleKind; readonly nodeId: string } | undefined {
  const kind = KINDS.find((candidate) => id.startsWith(PREFIX[candidate]));
  return kind && { kind, nodeId: id.slice(PREFIX[kind].length) };
}
