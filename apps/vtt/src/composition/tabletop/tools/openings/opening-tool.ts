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
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait, openingStructureType, panelRailOf, type PanelRail } from "../../../../features/edit-construction/index.ts";

import { boundaryUsage, createBoundaryEdges, reverseGeometry } from "../core/boundary-edges.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { findWallSurfaceAt } from "../walls/wall-shared.ts";
import { commitChange } from "../../effects/effect-commit.ts";
import { shapeChangeOfAddition } from "../../effects/shape-change.ts";
import {
  commitOpeningReplacement,
  hostWallOf,
  openingOverlapsSibling,
  openingSpan,
  rimCorners,
} from "./opening-shared.ts";

export const OPENING_COLOR: Record<OpeningParams["openingKind"], number> = {
  window: 0x7dd3fc,
  door: 0xd97706,
};

const EDIT_CHANNEL = "opening-edit";
const OVERLAP_COLOR = 0xef4444;

/**
 * One tool for the whole life of an opening: click a wall to stamp a new
 * door or window onto it; click an *existing* one to select it, then click
 * its host wall again to move or resize it (a fresh rim replaces the old
 * one, using whatever width/height/sill/kind the tool's own params
 * currently hold -- adjust a slider and click again to resize, click
 * somewhere else along the wall to move); Delete or Backspace, with a
 * selection standing, removes it and restores the wall. One tool, not two
 * modes, because that is how every other pick-then-act gesture in this app
 * already works (`edit-region-tool.ts` grabs whatever is under the pointer
 * rather than switching between a "select" and an "edit" tool).
 *
 * Editing is always a full replace, never a nudge: `openingStructureType`'s
 * own role (`panel-structure.ts`) resolves every gesture to `"regenerate"`
 * for exactly this reason -- there is no meaningful "the same rim, moved a
 * little" on a rail that may be curved.
 *
 * Where the opening lands is read off the panel itself, not off the ground:
 * `panel-rail.ts` flattens the panel into travel-and-height, so a curved
 * wall is travelled rather than spanned and a window sits on the curve
 * instead of cutting across it.
 */

interface Selected {
  readonly openingSurfaceKey: ConstructionSurfaceKey;
  readonly wallSurfaceKey: ConstructionSurfaceKey;
  readonly holeIndex: number;
  readonly rail: PanelRail;
}

let selected: Selected | undefined;

function clearSelection(ctx: ToolContext): void {
  selected = undefined;
  ctx.reportSelection(undefined);
  ctx.runtime.clearPreview(EDIT_CHANNEL);
}

/** The opening region under the pointer, if any -- the same pick-by-`surfaceRef` read `wallUnder` uses below, scoped to the opening's own surface type so clicking a placed window never gets read as clicking the wall behind it. */
function openingUnder(ctx: ToolContext, sample: PointerSample): ConstructionRegionTopology | undefined {
  const picked = sample.surfaceRef;
  if (picked === undefined) return undefined;
  return ctx.runtime
    .getAllRegionTopologies()
    .find((topology) => topology.surfaceType === openingStructureType.surfaceType && surfaceRefFromNodeSet(topology.surfaceKey) === picked);
}

function select(ctx: ToolContext, opening: ConstructionRegionTopology): boolean {
  const host = hostWallOf(ctx, opening);
  if (host === undefined) return false;
  const rail = panelRailOf(ctx.runtime, host.wall);
  if (rail === undefined) return false;
  const span = openingSpan(rail, opening);
  if (span === undefined) return false;
  selected = { openingSurfaceKey: opening.surfaceKey, wallSurfaceKey: host.wall.surfaceKey, holeIndex: host.holeIndex, rail };
  const center = rail.positionAt((span.from + span.to) / 2, (span.bottom + span.top) / 2);
  ctx.reportSelection({ id: surfaceRefFromNodeSet(opening.surfaceKey), point: center });
  return true;
}

/** The move/resize preview for the currently selected opening, at the hovered spot on its host wall. */
function editPreview(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext): ReturnType<typeof segmentsPreview> | undefined {
  if (selected === undefined) return undefined;
  const wall = ctx.runtime.getRegionTopology(selected.wallSurfaceKey);
  if (wall === undefined) return undefined;
  const rail = panelRailOf(ctx.runtime, wall) ?? selected.rail;
  const rim = rimCorners(rail, rail.travelTo(gesture.current.point), params);
  if (rim === undefined) return undefined;
  const overlaps = openingOverlapsSibling(rail, wall, rim.from, rim.to, rim.bottom, rim.top, selected.holeIndex);
  const ring = [...rim.corners, rim.corners[0]!];
  const positions: number[] = [];
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const from = ring[index]!;
    const to = ring[index + 1]!;
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  }
  return segmentsPreview(Float32Array.from(positions), overlaps ? OVERLAP_COLOR : OPENING_COLOR[params.openingKind]);
}

/** Moves or resizes the selected opening to `sample`'s spot on its host wall -- the click that follows selecting one. */
function commitEdit(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
  const current = selected;
  if (current === undefined) return;
  const wall = ctx.runtime.getRegionTopology(current.wallSurfaceKey);
  if (wall === undefined) {
    clearSelection(ctx);
    ctx.reportFeedback({ tone: "error", message: "A parede desta abertura nao existe mais." });
    return;
  }
  const rail = panelRailOf(ctx.runtime, wall) ?? current.rail;
  const rim = rimCorners(rail, rail.travelTo(sample.point), params);
  if (rim === undefined) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: nao cabe aqui." });
    return;
  }
  if (openingOverlapsSibling(rail, wall, rim.from, rim.to, rim.bottom, rim.top, current.holeIndex)) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: sobreporia outra abertura ja existente nesta parede." });
    return;
  }

  const causeId = scopedToolId(ctx, "opening-edit", ctx.nextSequence());
  const { recorded, error } = commitOpeningReplacement(
    ctx,
    causeId,
    { faceSurfaceKey: current.openingSurfaceKey, wallSurfaceKey: current.wallSurfaceKey, holeIndex: current.holeIndex },
    { wallSurfaceKey: wall.surfaceKey, rail, from: rim.from, to: rim.to, bottom: rim.bottom, top: rim.top, openingKind: params.openingKind },
  );
  clearSelection(ctx);
  if (error !== undefined) {
    ctx.reportFeedback({ tone: "error", message: `Abertura: ${error}` });
    return;
  }
  if (recorded) ctx.history?.record({ kind: "transaction", transactionId: causeId });
  ctx.reportFeedback({ tone: "success", message: "Abertura movida/redimensionada." });
}

export const openingTool: ConstructionTool<"opening"> = {
  id: "opening",
  defaultParams: () => DEFAULT_TOOL_PARAMS.opening,
  previewOnHover: true,

  previewFor(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext) {
    if (selected !== undefined) return editPreview(gesture, params, ctx);
    const placed = resolvePlacement(ctx, gesture.current, params);
    if (placed === undefined) return undefined;
    const ring = [...placed.corners, placed.corners[0]!];
    const positions: number[] = [];
    for (let index = 0; index + 1 < ring.length; index += 1) {
      const from = ring[index]!;
      const to = ring[index + 1]!;
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    }
    return segmentsPreview(Float32Array.from(positions), OPENING_COLOR[params.openingKind]);
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
    const opening = openingUnder(ctx, sample);
    if (opening !== undefined) {
      if (select(ctx, opening)) {
        ctx.reportFeedback({ tone: "info", message: "Abertura selecionada. Ajuste largura/altura/peitoril e clique na parede para mover ou redimensionar. Delete apaga." });
      } else {
        ctx.reportFeedback({ tone: "error", message: "Nao foi possivel identificar a parede desta abertura." });
      }
      return;
    }

    if (selected !== undefined) {
      commitEdit(ctx, sample, params);
      return;
    }

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
    const bottomGeometry = placed.rail.geometryBetween(placed.from, placed.to);
    const topGeometry = reverseGeometry(bottomGeometry);
    const boundary: ConstructionOrientedEdgeUse[] = [
      edges.use(nodes[0]!.id, nodes[1]!.id, bottomGeometry),
      edges.use(nodes[1]!.id, nodes[2]!.id),
      edges.use(nodes[2]!.id, nodes[3]!.id, topGeometry),
      edges.use(nodes[3]!.id, nodes[0]!.id),
    ];

    const patch = {
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
    };
    // The face and the hole it stands in are one transaction: a face that
    // does not fit leaves neither its rim nor an opening nobody stands in.
    let recorded: boolean;
    try {
      ({ recorded } = commitChange(ctx.runtime, { transactionId: causeId }, () => {
        const outcome = ctx.runtime.addPatch(patch, "local", causeId);
        if (outcome.skippedRegionIds.length > 0) throw new Error("a face nao coube sobre o que ja existe ali.");
        ctx.runtime.addHole(
          {
            surfaceKey: placed.surfaceKey,
            hole: [...boundary].reverse().map((use) => ({ edgeId: use.edgeId, reversed: !use.reversed })),
          },
          "local",
          causeId,
        );
        return { value: outcome, change: shapeChangeOfAddition(ctx.runtime, patch, outcome) };
      }));
    } catch (error) {
      ctx.reportFeedback({ tone: "error", message: `Abertura: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    if (recorded) ctx.history?.record({ kind: "transaction", transactionId: causeId });
    ctx.reportFeedback({
      tone: "success",
      message: params.openingKind === "door" ? "Porta aberta na parede." : "Janela aberta na parede.",
    });
  },

  onDeleteKey(ctx: ToolContext): void {
    if (selected === undefined) return;
    const removal = { faceSurfaceKey: selected.openingSurfaceKey, wallSurfaceKey: selected.wallSurfaceKey, holeIndex: selected.holeIndex };
    const causeId = scopedToolId(ctx, "opening-edit-delete", ctx.nextSequence());
    const { recorded, error } = commitOpeningReplacement(ctx, causeId, removal, undefined);
    clearSelection(ctx);
    if (error !== undefined) {
      ctx.reportFeedback({ tone: "error", message: `Abertura: ${error}` });
      return;
    }
    if (recorded) ctx.history?.record({ kind: "transaction", transactionId: causeId });
    ctx.reportFeedback({ tone: "success", message: "Abertura removida; parede restaurada." });
  },

  onCancel(ctx: ToolContext): void {
    clearSelection(ctx);
  },
};

interface Placement {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly corners: readonly ConstructionPosition[];
  readonly rail: PanelRail;
  readonly from: number;
  readonly to: number;
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
 *
 * Restricted to `"partition"`-trait topologies: an opening's own face is an
 * upright panel too (built the same way, off the same rail), and without
 * this an already-placed window would read as "a wall" the moment it was
 * clicked, stamping a second, nested opening into it instead of the click
 * ever reaching `openingUnder`'s own selection check above.
 */
function wallUnder(ctx: ToolContext, sample: PointerSample): ConstructionSurfaceKey | undefined {
  const picked = sample.surfaceRef;
  if (picked !== undefined) {
    const hit = ctx.runtime
      .getAllRegionTopologies()
      .find((topology) => hasTrait(topology.surfaceType, "partition") && surfaceRefFromNodeSet(topology.surfaceKey) === picked);
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
  const rail = panelRailOf(ctx.runtime, topology);
  if (rail === undefined) return undefined;
  const placed = rimCorners(rail, rail.travelTo(sample.point), params);
  return placed === undefined ? undefined : { surfaceKey, corners: placed.corners, rail, from: placed.from, to: placed.to };
}
