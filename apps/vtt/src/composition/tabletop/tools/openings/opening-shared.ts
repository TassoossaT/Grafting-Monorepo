import type { OpeningParams } from "@/features/edit-construction";
import type {
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { openingStructureType, type PanelRail } from "../../../../features/edit-construction/index.ts";

import { boundaryUsage, createBoundaryEdges, reverseGeometry } from "../core/boundary-edges.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { commitChange } from "../../effects/effect-commit.ts";
import { shapeChangeOfAddition } from "../../effects/shape-change.ts";

/**
 * What creating, moving, resizing and deleting an opening all share: the
 * rim geometry an opening's own rectangle resolves to on its host wall's
 * rail, and the one-transaction commit that stands a face in it (and, for
 * an edit, first removes whatever stood there before).
 */

/** How much wall must be left standing to either side of an opening, and above and below it. */
export const MARGIN = 0.15;

/** The four corners of an opening, in the order its own face walks them, plus the travel span they sit on -- needed to declare the rim's own bottom edge with {@link PanelRail.geometryBetween} rather than the whole rail's curvature. */
export function rimCorners(
  rail: PanelRail,
  at: number,
  params: OpeningParams,
): { readonly corners: readonly ConstructionPosition[]; readonly from: number; readonly to: number; readonly bottom: number; readonly top: number } | undefined {
  const half = params.width / 2;
  const from = Math.max(MARGIN, Math.min(at - half, rail.length - MARGIN - params.width));
  const to = from + params.width;
  if (to > rail.length - MARGIN) return undefined;

  // A door sits on the floor; anything else starts at its own sill. Either
  // way the wall has to survive above it.
  const bottom = rail.baseY + Math.max(params.openingKind === "door" ? 0 : MARGIN, params.sill);
  const top = bottom + params.height;
  if (top > rail.topY - MARGIN) return undefined;

  return {
    corners: [
      rail.positionAt(from, bottom),
      rail.positionAt(to, bottom),
      rail.positionAt(to, top),
      rail.positionAt(from, top),
    ],
    from,
    to,
    bottom,
    top,
  };
}

/**
 * An existing opening's own current parameters, read back off its rim --
 * the inverse of {@link rimCorners}. `openingKind` has no field of its own
 * to read (only `rimCorners`' own floor clamp cared, at creation time), so
 * it is guessed from how close the sill sits to the floor: a genuine door
 * is indistinguishable from a window whose sill someone dragged to zero,
 * and that is fine -- the same shape means the same thing either way.
 */
export function deriveOpeningParams(rail: PanelRail, topology: ConstructionRegionTopology): OpeningParams | undefined {
  const [outer] = topology.outerLoops;
  if (outer === undefined || outer.length === 0) return undefined;
  const positions = outer.map((edge) => topology.nodes.find((node) => node.id === edge.startNodeId)?.position);
  if (positions.some((position) => position === undefined)) return undefined;
  const travels = positions.map((position) => rail.travelTo(position!));
  const ys = positions.map((position) => position!.y);
  const from = Math.min(...travels);
  const to = Math.max(...travels);
  const bottom = Math.min(...ys);
  const top = Math.max(...ys);
  const sill = bottom - rail.baseY;
  return {
    openingKind: sill < MARGIN + 1e-3 ? "door" : "window",
    width: to - from,
    height: top - bottom,
    sill: Math.max(0, sill),
  };
}

/** The travel span and height range an existing opening's rim already occupies. */
export function openingSpan(rail: PanelRail, topology: ConstructionRegionTopology): { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number } | undefined {
  const [outer] = topology.outerLoops;
  if (outer === undefined || outer.length === 0) return undefined;
  const positions = outer.map((edge) => topology.nodes.find((node) => node.id === edge.startNodeId)?.position);
  if (positions.some((position) => position === undefined)) return undefined;
  const travels = positions.map((position) => rail.travelTo(position!));
  const ys = positions.map((position) => position!.y);
  return { from: Math.min(...travels), to: Math.max(...travels), bottom: Math.min(...ys), top: Math.max(...ys) };
}

/**
 * The wall hosting `openingTopology`, and which of its holes is this
 * opening's own rim -- found the same way a curve handle finds which face
 * owns a grabbed edge (`curve-edit-gesture.ts`'s `contourGesture`): by
 * which topology's boundary already references one of the opening's own
 * edges, since the hole and the face share it.
 */
export function hostWallOf(
  ctx: ToolContext,
  openingTopology: ConstructionRegionTopology,
): { readonly wall: ConstructionRegionTopology; readonly holeIndex: number } | undefined {
  const [outer] = openingTopology.outerLoops;
  const edgeId = outer?.[0]?.edgeId;
  if (edgeId === undefined) return undefined;
  for (const candidate of ctx.runtime.getAllRegionTopologies()) {
    const holeIndex = candidate.holes.findIndex((loop) => loop.some((use) => use.edgeId === edgeId));
    if (holeIndex >= 0) return { wall: candidate, holeIndex };
  }
  return undefined;
}

/**
 * Whether an opening at `[from, to] x [bottom, top]` would overlap any
 * *other* hole already on `wall` -- a whole extra opening's worth of
 * travel-and-height rectangle, not merely a touching edge (the `MARGIN`
 * both rims already keep is what makes two side-by-side openings legal).
 * `excludeHoleIndex` is the opening's own hole, when moving/resizing one
 * that already exists -- it must never collide with itself.
 */
export function openingOverlapsSibling(
  rail: PanelRail,
  wall: ConstructionRegionTopology,
  from: number,
  to: number,
  bottom: number,
  top: number,
  excludeHoleIndex?: number,
): boolean {
  return wall.holes.some((loop, index) => {
    if (index === excludeHoleIndex || loop.length === 0) return false;
    const positions = loop.map((edge) => wall.nodes.find((node) => node.id === edge.startNodeId)?.position).filter((position): position is ConstructionPosition => position !== undefined);
    if (positions.length === 0) return false;
    const travels = positions.map((position) => rail.travelTo(position));
    const ys = positions.map((position) => position.y);
    const otherFrom = Math.min(...travels), otherTo = Math.max(...travels);
    const otherBottom = Math.min(...ys), otherTop = Math.max(...ys);
    return from < otherTo && to > otherFrom && bottom < otherTop && top > otherBottom;
  });
}

interface OpeningPlacement {
  readonly wallSurfaceKey: ConstructionSurfaceKey;
  readonly rail: PanelRail;
  readonly from: number;
  readonly to: number;
  readonly bottom: number;
  readonly top: number;
}

/** What to remove before (re)placing, when replacing or deleting an existing opening. */
export interface OpeningRemoval {
  readonly faceSurfaceKey: ConstructionSurfaceKey;
  readonly wallSurfaceKey: ConstructionSurfaceKey;
  readonly holeIndex: number;
}

/** Builds the same node/edge/patch shape `opening-tool.ts` has always created a new opening from -- factored out so an edit can replay it against a different rim. */
function buildOpeningPatch(ctx: ToolContext, idPrefix: string, place: OpeningPlacement) {
  const nodes = [
    place.rail.positionAt(place.from, place.bottom),
    place.rail.positionAt(place.to, place.bottom),
    place.rail.positionAt(place.to, place.top),
    place.rail.positionAt(place.from, place.top),
  ].map((position, index) => ({ id: `${idPrefix}:c${index}` as ConstructionNodeId, position }));

  const edges = createBoundaryEdges(ctx.tableId, {
    kind: "private-when-full",
    runPrefix: idPrefix,
    existingUses: boundaryUsage(ctx),
  });
  const bottomGeometry = place.rail.geometryBetween(place.from, place.to);
  const topGeometry = reverseGeometry(bottomGeometry);
  const boundary: ConstructionOrientedEdgeUse[] = [
    edges.use(nodes[0]!.id, nodes[1]!.id, bottomGeometry),
    edges.use(nodes[1]!.id, nodes[2]!.id),
    edges.use(nodes[2]!.id, nodes[3]!.id, topGeometry),
    edges.use(nodes[3]!.id, nodes[0]!.id),
  ];

  return {
    boundary,
    patch: {
      nodes,
      edges: edges.all(),
      regions: [
        {
          regionId: nodes.map((node) => node.id).join("|"),
          boundary,
          surfaceType: openingStructureType.surfaceType,
          physical: false,
        },
      ],
    },
  };
}

/**
 * One transaction: optionally close an existing opening back up (its face
 * deleted, its hole removed from the host wall -- restoring the wall,
 * criterion 3 of #231), then optionally stand a new one in a fresh rim
 * (criterion 1, move/resize -- delete and recreate rather than nudging the
 * existing nodes, since a curved wall's rail parametrization has no
 * meaningful notion of "the same rim, stretched"). Passing both is a move
 * or a resize; passing only `removal` is a delete; passing only `place` is
 * a plain creation (what `opening-tool.ts` itself still does).
 */
export function commitOpeningReplacement(
  ctx: ToolContext,
  causeId: string,
  removal: OpeningRemoval | undefined,
  place: (OpeningPlacement & { readonly openingKind: OpeningParams["openingKind"] }) | undefined,
): { readonly recorded: boolean; readonly error?: string } {
  let recorded = false;
  try {
    ({ recorded } = commitChange(ctx.runtime, { transactionId: causeId }, () => {
      if (removal !== undefined) {
        ctx.runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey: removal.faceSurfaceKey }], "local", causeId);
        ctx.runtime.removeHole({ surfaceKey: removal.wallSurfaceKey, index: removal.holeIndex }, "local", causeId);
      }
      if (place === undefined) return { value: undefined };

      const sequence = ctx.nextSequence();
      const idPrefix = scopedToolId(ctx, `opening-${sequence}`);
      const { boundary, patch } = buildOpeningPatch(ctx, idPrefix, place);
      const outcome = ctx.runtime.addPatch(patch, "local", causeId);
      if (outcome.skippedRegionIds.length > 0) throw new Error("a face nao coube sobre o que ja existe ali.");
      ctx.runtime.addHole(
        {
          surfaceKey: place.wallSurfaceKey,
          hole: [...boundary].reverse().map((use) => ({ edgeId: use.edgeId, reversed: !use.reversed })),
        },
        "local",
        causeId,
      );
      return { value: outcome, change: shapeChangeOfAddition(ctx.runtime, patch, outcome) };
    }));
  } catch (error) {
    return { recorded: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { recorded };
}
