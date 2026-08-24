import type { ConstructionPosition } from "@/ports";

import { addPosition, type AtomicEditOp } from "../../../orchestration/atomic-edit.ts";
import type { SpineControlNode } from "./spine-graph.ts";

/**
 * The op that moves one spine control node by `delta`.
 *
 * Deliberately the same `move-vertex` op, built with the same `addPosition`
 * helper, that `edit-orchestrator.ts`'s own vertex case already produces --
 * there is no separate edit pipeline for a spine control node to bypass.
 * `move-vertex` only ever names a node id and a position; nothing about it
 * assumes degree 2, so a junction node with three or more curve edges moves
 * through this exact op the same as an ordinary point on a straight run. The
 * graph, not this function, is what makes a junction share one id in the
 * first place (see `spine-node-id.ts`).
 */
export function moveSpineControlNode(
  node: SpineControlNode,
  delta: ConstructionPosition,
): AtomicEditOp {
  return { kind: "move-vertex", nodeId: node.nodeId, position: addPosition(node.position, delta) };
}
