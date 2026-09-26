import type { ConstructionGraphSnapshot } from "@/ports";

import { globalHandleId, globalHandleOf, type GlobalHandleKind } from "../global-handles/global-handle-ids.ts";
import { curvePick } from "../topology/curve-handles.ts";

/** A spine's global handles are the generic ones (`global-handles/`), named after its lowest control node. */
export type SpineGlobalHandleKind = GlobalHandleKind;
export { globalHandleId as spineGlobalHandleId, globalHandleOf as spineGlobalHandleOf };

/** The spine control node `id` stands for: a global handle's own node, a curve handle's span start, or `id` itself. */
export function spineMemberOf(graph: ConstructionGraphSnapshot, id: string): string {
  const global = globalHandleOf(id);
  if (global) return global.nodeId;
  const pick = curvePick(id);
  return pick ? graph.edges.find((edge) => edge.edgeId === pick.edgeId)?.startNodeId ?? id : id;
}
