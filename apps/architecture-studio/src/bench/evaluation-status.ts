import type { BenchNodeStatus } from "./bench-composition.ts";
import type { EvaluationOutcome } from "./evaluation-client.ts";
import type { EvaluationPlan } from "./evaluation-plan.ts";

/**
 * Decides what badge each node wears after one evaluation pass.
 *
 * Kept apart from the React component so the precedence between overlapping
 * signals is a testable rule rather than a rendering accident.
 *
 * @param plan - The pass that was run.
 * @param outcome - What the worker reported.
 * @param cyclicNodeIds - Nodes a cycle left unorderable, when there was one.
 * @returns One status per node the pass knows about.
 */
export function resolveNodeStatuses(
  plan: EvaluationPlan,
  outcome: EvaluationOutcome | null,
  cyclicNodeIds: readonly string[] = [],
): Readonly<Record<string, BenchNodeStatus>> {
  const statuses: Record<string, BenchNodeStatus> = {};

  // Least specific first, so each later signal overwrites the one before it.
  for (const skipped of plan.skipped) statuses[skipped.nodeId] = "waiting";
  for (const nodeId of outcome?.reused ?? []) statuses[nodeId] = "reused";
  for (const nodeId of outcome?.evaluated ?? []) statuses[nodeId] = "evaluated";
  for (const nodeId of Object.keys(outcome?.failures ?? {})) statuses[nodeId] = "failed";
  // A cycle is the most specific thing that can be wrong with a node: it is
  // why nothing else about that node could even be attempted.
  for (const nodeId of cyclicNodeIds) statuses[nodeId] = "failed";

  return Object.freeze(statuses);
}

/**
 * Chooses which node's result the 3D panel should show.
 *
 * A viewport element exists to be watched, so it wins over the selection; that
 * is what lets a user click around a chain while the render keeps showing the
 * end of it. Without one, the selected node is previewed, which is how a single
 * element is inspected in isolation.
 *
 * @param viewportNodeIds - Placed viewport elements, in graph order.
 * @param selectedNodeId - Node the user has selected, if any.
 * @returns The node to preview, or `null` when there is nothing to show.
 */
export function resolvePreviewTarget(
  viewportNodeIds: readonly string[],
  selectedNodeId: string | null,
): string | null {
  if (selectedNodeId !== null && viewportNodeIds.includes(selectedNodeId)) return selectedNodeId;
  return viewportNodeIds[0] ?? selectedNodeId;
}
