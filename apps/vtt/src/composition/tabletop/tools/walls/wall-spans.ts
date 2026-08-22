import type {
  ConstructionEdgeId,
  ConstructionNodeId,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import type { ToolContext } from "../core/tool-context.ts";

/**
 * Every upright wall panel currently on the table, recovered from the
 * engine's own region topology.
 *
 * This replaces the two near-identical `wallSpans` helpers `wall-shared.ts`
 * and `room-lookup.ts` each carried. They both read a surface's
 * `orderedNodeRefs` out of the map projection, which stopped being a list of
 * node ids the moment every surface became an analytic region -- a region
 * projects as its own `["@region", id]` key, so both helpers silently
 * matched nothing. Reading the boundary the engine actually reports fixes
 * that and removes the duplication at the same time.
 */

const WALL_SURFACE_TYPES = new Set(["wall-white", "wall-gray"]);

export interface WallSpan {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly surfaceType: string;
  readonly physical: boolean;
  readonly bottomA: ConstructionNodeId;
  readonly bottomB: ConstructionNodeId;
  readonly topA: ConstructionNodeId;
  readonly topB: ConstructionNodeId;
  /** The bottom corner under {@link bottomA}/{@link topA}. */
  readonly a: ConstructionPosition;
  readonly b: ConstructionPosition;
  readonly topY: number;
  /** Boundary edges running along the baseline -- what a T-junction subdivides. */
  readonly bottomEdgeIds: readonly ConstructionEdgeId[];
  /** Boundary edges running along the top, the paired half of the same subdivision. */
  readonly topEdgeIds: readonly ConstructionEdgeId[];
}

/** Two nodes belong to the same column when they sit on one XZ point and differ only in height. */
function sameXz(a: ConstructionPosition, b: ConstructionPosition): boolean {
  return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
}

interface Column {
  readonly bottom: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition };
  readonly top: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition };
}

/**
 * The panel's own columns: its nodes grouped by XZ, each group's lowest and
 * highest node.
 *
 * A panel does not have to hold exactly four nodes. A T-junction inserts a
 * vertex partway along an edge, which adds a column without dividing
 * anything -- what divides a wall is an edge running side to side, never a
 * vertex on the way. Reading columns rather than counting nodes is what lets
 * a welded panel keep being recognised as the wall it still is.
 */
function columnsOf(nodes: readonly { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[]): readonly Column[] {
  const groups: { readonly id: ConstructionNodeId; readonly position: ConstructionPosition }[][] = [];
  for (const node of nodes) {
    const group = groups.find((candidate) => candidate[0] !== undefined && sameXz(candidate[0].position, node.position));
    if (group === undefined) groups.push([node]);
    else group.push(node);
  }
  return groups.flatMap((group) => {
    const sorted = [...group].sort((left, right) => left.position.y - right.position.y);
    const bottom = sorted[0];
    const top = sorted[sorted.length - 1];
    if (bottom === undefined || top === undefined || bottom === top) return [];
    return [{ bottom, top }];
  });
}

/** The two columns furthest apart in XZ -- a panel's own extremities, which is what a wall's two ends always are. */
function extremities(columns: readonly Column[]): readonly [Column, Column] | undefined {
  let best: { readonly pair: readonly [Column, Column]; readonly distanceSq: number } | undefined;
  for (let left = 0; left < columns.length; left += 1) {
    for (let right = left + 1; right < columns.length; right += 1) {
      const a = columns[left];
      const b = columns[right];
      if (a === undefined || b === undefined) continue;
      const dx = a.bottom.position.x - b.bottom.position.x;
      const dz = a.bottom.position.z - b.bottom.position.z;
      const distanceSq = dx * dx + dz * dz;
      if (best === undefined || distanceSq > best.distanceSq) best = { pair: [a, b], distanceSq };
    }
  }
  return best?.pair;
}

function spanOf(topology: ConstructionRegionTopology): WallSpan | undefined {
  if (!WALL_SURFACE_TYPES.has(topology.surfaceType)) return undefined;
  const columns = columnsOf(topology.nodes);
  const ends = extremities(columns);
  if (ends === undefined) return undefined;
  const [a, b] = ends;

  const baseline = Math.min(a.bottom.position.y, b.bottom.position.y);
  const atBaseline = (id: ConstructionNodeId): boolean => {
    const node = topology.nodes.find((candidate) => candidate.id === id);
    return node !== undefined && Math.abs(node.position.y - baseline) < 1e-3;
  };
  const edges = topology.outerLoops.flat();
  return {
    surfaceKey: topology.surfaceKey,
    surfaceType: topology.surfaceType,
    physical: topology.physical,
    bottomA: a.bottom.id,
    topA: a.top.id,
    bottomB: b.bottom.id,
    topB: b.top.id,
    a: a.bottom.position,
    b: b.bottom.position,
    topY: a.top.position.y,
    bottomEdgeIds: edges
      .filter((edge) => atBaseline(edge.startNodeId) && atBaseline(edge.endNodeId))
      .map((edge) => edge.edgeId),
    topEdgeIds: edges
      .filter((edge) => !atBaseline(edge.startNodeId) && !atBaseline(edge.endNodeId))
      .map((edge) => edge.edgeId),
  };
}

export function wallSpans(ctx: ToolContext): readonly WallSpan[] {
  return ctx.runtime
    .getAllRegionTopologies()
    .map(spanOf)
    .filter((span): span is WallSpan => span !== undefined);
}
