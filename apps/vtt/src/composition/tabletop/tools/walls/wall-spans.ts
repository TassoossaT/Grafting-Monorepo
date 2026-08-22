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

function sameXz(a: ConstructionPosition, b: ConstructionPosition): boolean {
  return Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.z - b.z) < 1e-3;
}

function spanOf(topology: ConstructionRegionTopology): WallSpan | undefined {
  if (!WALL_SURFACE_TYPES.has(topology.surfaceType)) return undefined;
  const nodes = topology.nodes;
  if (nodes.length !== 4) return undefined;

  const [first, ...rest] = nodes;
  if (first === undefined) return undefined;
  const groupA = [first, ...rest.filter((node) => sameXz(node.position, first.position))];
  const groupB = rest.filter((node) => !sameXz(node.position, first.position));
  if (groupA.length !== 2 || groupB.length !== 2) return undefined;

  const [a0, a1] = [...groupA].sort((x, y) => x.position.y - y.position.y);
  const [b0, b1] = [...groupB].sort((x, y) => x.position.y - y.position.y);
  if (a0 === undefined || a1 === undefined || b0 === undefined || b1 === undefined) return undefined;

  const baseline = a0.position.y;
  const atBaseline = (id: ConstructionNodeId): boolean => {
    const node = nodes.find((candidate) => candidate.id === id);
    return node !== undefined && Math.abs(node.position.y - baseline) < 1e-3;
  };
  const edges = topology.outerLoops.flat();
  return {
    surfaceKey: topology.surfaceKey,
    surfaceType: topology.surfaceType,
    physical: topology.physical,
    bottomA: a0.id,
    topA: a1.id,
    bottomB: b0.id,
    topB: b1.id,
    a: a0.position,
    b: b0.position,
    topY: a1.position.y,
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
