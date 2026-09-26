import type { ConstructionGraphSnapshot } from "@/ports";

import { curvePick } from "../topology/curve-handles.ts";

/**
 * The handles that stand for a whole spine rather than one of its points:
 * the pivot that moves it, the handle that turns it round the pivot, and the
 * handles at its far end that raise it and -- on a spiral -- wind it. Which of them a spine shows is its owner's
 * declaration (`SpineGeneration.globalHandles`).
 *
 * Every one is named after the spine's lowest control node id, so it stays
 * the same handle through any edit that keeps that node. None is a graph
 * node. This module is the only place their ids are made or read.
 */
export type SpineGlobalHandleKind = "pivot" | "rotate" | "height" | "turns";

const PREFIX: Readonly<Record<SpineGlobalHandleKind, string>> = { pivot: "spine-pivot:", rotate: "spine-rotate:", height: "spine-height:", turns: "spine-turns:" };
const KINDS = Object.keys(PREFIX) as readonly SpineGlobalHandleKind[];

export const spineGlobalHandleId = (kind: SpineGlobalHandleKind, nodeId: string): string => `${PREFIX[kind]}${nodeId}`;

/** Which global handle `id` names, and after which node; `undefined` for anything else. */
export function spineGlobalHandleOf(id: string): { readonly kind: SpineGlobalHandleKind; readonly nodeId: string } | undefined {
  const kind = KINDS.find((candidate) => id.startsWith(PREFIX[candidate]));
  return kind && { kind, nodeId: id.slice(PREFIX[kind].length) };
}

/** The spine control node `id` stands for: a global handle's own node, a curve handle's span start, or `id` itself. */
export function spineMemberOf(graph: ConstructionGraphSnapshot, id: string): string {
  const global = spineGlobalHandleOf(id);
  if (global) return global.nodeId;
  const pick = curvePick(id);
  return pick ? graph.edges.find((edge) => edge.edgeId === pick.edgeId)?.startNodeId ?? id : id;
}
