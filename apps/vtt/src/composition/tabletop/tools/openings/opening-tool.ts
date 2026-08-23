import type { OpeningParams } from "@/features/edit-construction";
import type {
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPosition,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { DEFAULT_TOOL_PARAMS } from "../../../../features/edit-construction/index.ts";

import { boundaryUsage, createBoundaryEdges } from "../core/boundary-edges.ts";
import { boundaryUsage, createBoundaryEdges, reverseGeometry } from "../core/boundary-edges.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { findWallSurfaceAt } from "../walls/wall-shared.ts";
import { panelRailOf, type PanelRail } from "./panel-rail.ts";

/** How much wall must be left standing to either side of an opening, and above and below it. */
const MARGIN = 0.15;

const OPENING_COLOR: Record<OpeningParams["openingType"], number> = {
  window: 0x7dd3fc,
  door: 0xd97706,
};

/** The four corners of an opening, in the order its own face walks them. */
function rimCorners(rail: PanelRail, at: number, params: OpeningParams): readonly ConstructionPosition[] | undefined {
  const half = params.width / 2;
  const from = Math.max(MARGIN, Math.min(at - half, rail.length - MARGIN - params.width));
  const to = from + params.width;
  if (to > rail.length - MARGIN) return undefined;

  // A door sits on the floor; anything else starts at its own sill. Either
  // way the wall has to survive above it.
  const bottom = rail.baseY + Math.max(params.openingType === "door" ? 0 : MARGIN, params.sill);
  const top = bottom + params.height;
  if (top > rail.topY - MARGIN) return undefined;

  return [
    rail.positionAt(from, bottom),
    rail.positionAt(to, bottom),
    rail.positionAt(to, top),
    rail.positionAt(from, top),
  ];
}

/**
 * One click stamps an opening onto the wall panel under the pointer.
 *
 * Two calls, because the wall already exists and only one of them creates
 * anything: the patch registers the rim and the face standing in it, then
 * the wall is opened along that very rim. The second walks the loop
 * backwards -- reversing a ring is not just flipping each use, the order
 * reverses too -- so the rim ends up bounding the wall on one side and the
 * opening on the other, used twice, joined the way any two faces are.
 *
 * Where the opening lands is read off the panel itself, not off the ground:
 * `panel-rail.ts` flattens the panel into travel-and-height, so a curved
 * wall is travelled rather than spanned and a window sits on the curve
 * instead of cutting across it.
 */
export const openingTool: ConstructionTool<"opening"> = {
  id: "opening",
  defaultParams: () => DEFAULT_TOOL_PARAMS.opening,

  previewFor(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext) {
    const placed = resolvePlacement(ctx, gesture.current, params);
    if (placed === undefined) return undefined;
    const ring = [...placed.corners, placed.corners[0]!];
    const positions: number[] = [];
    for (let index = 0; index + 1 < ring.length; index += 1) {
      const from = ring[index]!;
      const to = ring[index + 1]!;
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    }
    return segmentsPreview(Float32Array.from(positions), OPENING_COLOR[params.openingType]);
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
    const placed = resolvePlacement(ctx, sample, params);
    if (placed === undefined) {
      ctx.reportFeedback({
        tone: "error",
        message: "Abertura: clique sobre uma parede reta ou curva, com espaco para a abertura caber nela.",
      });
      return;
    }

    const sequence = ctx.nextSequence();
    const causeId = scopedToolId(ctx, "opening", sequence);
    const idPrefix = scopedToolId(ctx, `opening-${sequence}`);
    const nodes = placed.corners.map((position, index) => ({
      id: `${idPrefix}:c${index}` as ConstructionNodeId,
      position,
    }));

    const edges = createBoundaryEdges(ctx.tableId, {
      kind: "private-when-full",
      runPrefix: idPrefix,
      existingUses: boundaryUsage(ctx),
    });
    const boundary: ConstructionOrientedEdgeUse[] = nodes.map((node, index) =>
      edges.use(node.id, nodes[(index + 1) % nodes.length]!.id),
    );
    const bottomGeometry = placed.rail.geometry;
    const topGeometry = reverseGeometry(placed.rail.geometry);
    const boundary: ConstructionOrientedEdgeUse[] = [
      edges.use(nodes[0]!.id, nodes[1]!.id, bottomGeometry),
      edges.use(nodes[1]!.id, nodes[2]!.id),
      edges.use(nodes[2]!.id, nodes[3]!.id, topGeometry),
      edges.use(nodes[3]!.id, nodes[0]!.id),
    ];

    const outcome = ctx.runtime.addPatch(
      {
        nodes,
        edges: edges.all(),
        regions: [
          {
            regionId: nodes.map((node) => node.id).join("|"),
            boundary,
            surfaceType: params.openingType,
            physical: false,
          },
        ],
      },
      "local",
      causeId,
    );
    if (outcome.skippedRegionIds.length > 0) {
      ctx.reportFeedback({ tone: "error", message: "Abertura: a face nao coube sobre o que ja existe ali." });
      return;
    }

    ctx.runtime.addHole(
      {
        surfaceKey: placed.surfaceKey,
        hole: [...boundary].reverse().map((use) => ({ edgeId: use.edgeId, reversed: !use.reversed })),
      },
      "local",
      causeId,
    );
    ctx.reportFeedback({
      tone: "success",
      message: params.openingType === "door" ? "Porta aberta na parede." : "Janela aberta na parede.",
    });
  },
};

interface Placement {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly corners: readonly ConstructionPosition[];
  readonly rail: PanelRail;
}

/**
 * Which wall the pointer is on.
 *
 * The renderer's own pick answers this exactly, for any shape, so it is what
 * gets asked first. `findWallSurfaceAt` is the fallback for a pointer that
 * resolved to ground rather than to a face -- and only a fallback, because
 * it measures against the straight line between a panel's two ends. On a
 * curved wall that line runs through open air, so a click on the far side of
 * the arc is nowhere near it.
 */
function wallUnder(ctx: ToolContext, sample: PointerSample): ConstructionSurfaceKey | undefined {
  const picked = sample.surfaceRef;
  if (picked !== undefined) {
    const hit = ctx.runtime
      .getAllRegionTopologies()
      .find((topology) => surfaceRefFromNodeSet(topology.surfaceKey) === picked);
    if (hit !== undefined) return hit.surfaceKey;
  }
  return findWallSurfaceAt(ctx, sample.point);
}

/** The wall under the pointer, read as a rail, with the opening already placed on it -- or `undefined` if it will not fit. */
function resolvePlacement(
  ctx: ToolContext,
  sample: PointerSample,
  params: OpeningParams,
): Placement | undefined {
  const surfaceKey = wallUnder(ctx, sample);
  if (surfaceKey === undefined) return undefined;
  const topology = ctx.runtime.getRegionTopology(surfaceKey);
  if (topology === undefined) return undefined;
  const rail = panelRailOf(topology);
  if (rail === undefined) return undefined;
  const corners = rimCorners(rail, rail.travelTo(sample.point), params);
  return corners === undefined ? undefined : { surfaceKey, corners };
  return corners === undefined ? undefined : { surfaceKey, corners, rail };
}
