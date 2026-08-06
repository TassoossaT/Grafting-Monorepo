import type { BenchNodeStatus } from "./bench-composition.ts";
import type { BenchNode } from "./bench-graph.ts";

// Deciding which nodes the surface still needs to be told about is the kind of
// bookkeeping that looks trivial and is not: getting it wrong pushes an update
// on every render, and because each update makes the renderer report back, the
// result is an unbreakable loop rather than a slow page. It lives here as a
// pure function so that rule is asserted rather than assumed.

/** One node whose badge on the surface no longer matches the last pass. */
export interface NodeStatusChange {
  /** Node to refresh. */
  readonly node: BenchNode;
  /** Badge it should now carry. */
  readonly status: BenchNodeStatus;
}

/**
 * Compares the statuses a pass produced against what the surface last rendered.
 *
 * The returned record is the complete new baseline, not a patch: it holds an
 * entry for every current node and none for nodes that have been removed. That
 * matters because the previous baseline stored only the nodes a pass had
 * touched, so an untouched node compared `undefined` against `"idle"` forever
 * and was refreshed on every single render.
 *
 * @param nodes - Nodes currently in the graph.
 * @param statuses - What the last pass reported, keyed by node.
 * @param rendered - The baseline from the previous comparison.
 * @returns The nodes that actually changed, and the baseline to store.
 */
export function diffNodeStatuses(
  nodes: readonly BenchNode[],
  statuses: Readonly<Record<string, BenchNodeStatus>>,
  rendered: Readonly<Record<string, BenchNodeStatus>>,
): {
  readonly changed: readonly NodeStatusChange[];
  readonly next: Readonly<Record<string, BenchNodeStatus>>;
} {
  const changed: NodeStatusChange[] = [];
  const next: Record<string, BenchNodeStatus> = {};

  for (const node of nodes) {
    const status = statuses[node.id] ?? "idle";
    next[node.id] = status;
    if (rendered[node.id] !== status) changed.push(Object.freeze({ node, status }));
  }

  return Object.freeze({ changed: Object.freeze(changed), next: Object.freeze(next) });
}
