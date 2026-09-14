import type {
  BezierPort,
  ConstructionEdgeSnapshot,
  ConstructionGraphPatch,
  ConstructionGraphSnapshot,
  ConstructionPatchEdge,
  ConstructionPatchRegion,
  ConstructionPosition,
  ConstructionRegionTopology,
} from "@/ports";

import { resolveCurves, curvePoint, curvePosition } from "../../topology/bezier-curve.ts";
import { createBoundaryEdges, type EdgeSharing } from "../../topology/boundary-edges.ts";
import { ownedBy, prospectiveGraph, spineComponent } from "../../spine/index.ts";
import type { SpineRegeneration, SpineRegenerationInput } from "../structure-type.ts";

/**
 * A curved wall generated from a spine, exactly the way a sloped platform is:
 * the spine's own bezier spans are the source of truth, and every panel
 * along them is regenerated from the curve, never painted as a separate
 * recipe. Unlike a platform's ribbon, a wall carries no lateral offset -- its
 * columns sit on the centerline itself, same as a drawn wall's do
 * (`wall-shared.ts`'s own `halfWidth: () => 0`).
 *
 * `bandOffsets[0]` doubles as the wall's height above its own curve: a wall
 * has no lateral profile, so the ribbon-offset field a spine span otherwise
 * carries is free for this.
 */

const TOLERANCE = 0.05;
const DEFAULT_HEIGHT = 3;

function heightOf(edge: Pick<ConstructionEdgeSnapshot, "curve">): number {
  const height = edge.curve?.bandOffsets[0];
  return height !== undefined && Number.isFinite(height) && height > 0 ? height : DEFAULT_HEIGHT;
}

const panelId = (spanId: string, index: number): string => `${spanId}:panel:${index}`;
const wallTopId = (nodeId: string): string => `${nodeId}:wall-top`;

export interface WallCurveSurface {
  readonly nodes: readonly { readonly id: string; readonly position: ConstructionPosition }[];
  readonly edges: readonly ConstructionPatchEdge[];
  readonly regions: readonly ConstructionPatchRegion[];
  readonly preview: Float32Array;
}

/**
 * The panels of every curved-wall span in `spans`, sampled along their
 * curves. A control node's own top (`wallTopId`) is shared by every span
 * that meets there, so adjacent spans in the same run weld at that column
 * exactly as `wallPatch` welds adjacent brush panels -- without borrowing
 * that builder's contour/closure bookkeeping, which assumes one contiguous
 * run rather than an independently regenerated span.
 */
export function wallCurveSurface(
  port: Pick<BezierPort, "curveBatch">,
  tableId: string,
  wallType: string,
  nodes: ReadonlyMap<string, ConstructionPosition>,
  spans: readonly ConstructionEdgeSnapshot[],
): WallCurveSurface {
  const resolved = resolveCurves(port, spans.map((span) => ({ handles: span.curve!, start: nodes.get(span.startNodeId)!, end: nodes.get(span.endNodeId)! })), TOLERANCE);
  const placed = new Map<string, ConstructionPosition>();
  const place = (id: string, position: ConstructionPosition): void => {
    if (!placed.has(id)) placed.set(id, position);
  };
  const boundary = createBoundaryEdges(tableId, { kind: "refuse-when-full" } satisfies EdgeSharing);
  const regions: ConstructionPatchRegion[] = [];
  const preview: number[] = [];

  spans.forEach((span, i) => {
    const samples = resolved[i]!.samples[0]!;
    const height = heightOf(span);
    const last = samples.length - 1;
    const columns = samples.map((sample, k) => {
      const bottomId = k === 0 ? span.startNodeId : k === last ? span.endNodeId : `${span.edgeId}:station:${sample.t.toFixed(6)}`;
      const bottom = curvePosition(sample.position);
      const top: ConstructionPosition = { x: bottom.x, y: bottom.y + height, z: bottom.z };
      place(bottomId, bottom);
      const topId = wallTopId(bottomId);
      place(topId, top);
      return { bottomId, topId };
    });
    for (let k = 0; k + 1 < columns.length; k += 1) {
      const from = columns[k]!;
      const to = columns[k + 1]!;
      regions.push({
        regionId: panelId(span.edgeId, k),
        surfaceType: wallType,
        physical: true,
        boundary: [
          boundary.use(from.bottomId, to.bottomId),
          boundary.use(to.bottomId, to.topId),
          boundary.use(to.topId, from.topId),
          boundary.use(from.topId, from.bottomId),
        ],
      });
      const fromPos = placed.get(from.bottomId)!;
      const toPos = placed.get(to.bottomId)!;
      preview.push(fromPos.x, fromPos.y, fromPos.z, toPos.x, toPos.y, toPos.z);
    }
  });
  return { nodes: [...placed].map(([id, position]) => ({ id, position })), edges: boundary.all(), regions, preview: Float32Array.from(preview) };
}

/** Regenerates every curved-wall span of `wallType` that a spine edit touches. */
export function regenerateWallCurveSpine(wallType: string) {
  return function regenerate(input: SpineRegenerationInput): SpineRegeneration | undefined {
    const { snapshot, graphPatch } = input;
    const after = prospectiveGraph(snapshot, graphPatch);
    const seeds = [...graphPatch.nodes.map((node) => node.id), ...graphPatch.edges.flatMap((edge) => [edge.startNodeId, edge.endNodeId])];
    const spans = spineComponent(after, seeds).edges.filter((edge) => edge.curve && ownedBy(wallType)(edge));
    if (spans.length === 0) return undefined;
    const before = spineComponent(snapshot, seeds).edges.filter(ownedBy(wallType));
    const removedIds = graphPatch.removedEdgeIds ?? [];
    const touchedEdgeIds = new Set([...spans, ...before].map((edge) => edge.edgeId).concat(removedIds));
    const standing = input.topologies.filter((topology) =>
      topology.surfaceType === wallType && [...touchedEdgeIds].some((id) => topology.surfaceKey[1]?.startsWith(`${id}:panel:`)));
    const surface = wallCurveSurface(input.port, input.tableId, wallType, new Map(after.nodes.map((node) => [node.id, node.position])), spans);
    return {
      request: {
        operationId: input.operationId,
        sourceSurfaceKeys: standing.map((topology) => topology.surfaceKey),
        patch: { nodes: surface.nodes, edges: surface.edges, regions: surface.regions },
        graphPatch: { ...graphPatch, nodes: [...graphPatch.nodes, ...surface.nodes] },
      },
      preview: surface.preview,
    };
  };
}

/**
 * The stroke-drawn creation path: fits a smooth cubic through the drawn
 * anchors (the same fit roads use), mints its control nodes and spans
 * owned by `wallType`, and regenerates them through the same path an edit
 * would take -- creation is not a second recipe.
 */
export function planWallCurveCreation(input: {
  readonly snapshot: ConstructionGraphSnapshot;
  readonly topologies: readonly ConstructionRegionTopology[];
  readonly port: BezierPort;
  readonly stroke: readonly ConstructionPosition[];
  readonly operationId: string;
  readonly tableId: string;
  readonly height: number;
  readonly tolerance: number;
  readonly wallType: string;
}): { readonly request: import("@/ports").ApplyPatchReplacementRequest; readonly preview: Float32Array; readonly selectedId: string } | undefined {
  if (!Number.isFinite(input.height) || input.height <= 0) throw Error("Informe uma altura positiva para a parede.");
  if (input.stroke.length < 2) return undefined;
  const fitted = input.port.curveBatch({ tolerance: Math.max(0.025, input.tolerance), commands: [{ kind: "fit", points: input.stroke.map(curvePoint) }] })[0]!;
  if (!fitted.curves.length) return undefined;

  const run = encodeURIComponent(input.operationId);
  const anchors = [...fitted.curves.map((c) => c.points[0]), fitted.curves.at(-1)!.points[3]];
  const nodes = anchors.map((p, i) => ({ id: `spine:wall-curve:${run}:${i}`, position: curvePosition(p) }));
  const edges = fitted.handles.map((handles, i) => ({
    edgeId: `spine-edge:wall-curve:${run}:${i}`,
    startNodeId: nodes[i]!.id,
    endNodeId: nodes[i + 1]!.id,
    curve: { ...handles, surfaceType: input.wallType, bandOffsets: [input.height] },
  }));
  const graphPatch: ConstructionGraphPatch = { nodes, edges };

  const regenerated = regenerateWallCurveSpine(input.wallType)({
    snapshot: input.snapshot, graphPatch, topologies: input.topologies, port: input.port, operationId: input.operationId, tableId: input.tableId,
  });
  return regenerated && { ...regenerated, selectedId: nodes[0]!.id };
}
