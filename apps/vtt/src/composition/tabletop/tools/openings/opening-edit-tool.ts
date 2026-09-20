import type { OpeningParams } from "@/features/edit-construction";
import type { ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { DEFAULT_TOOL_PARAMS, openingStructureType } from "../../../../features/edit-construction/index.ts";

import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { panelRailOf, type PanelRail } from "./panel-rail.ts";
import { OPENING_COLOR } from "./opening-tool.ts";
import {
  commitOpeningReplacement,
  hostWallOf,
  openingOverlapsSibling,
  openingSpan,
  rimCorners,
} from "./opening-shared.ts";

/**
 * Move, resize and delete an existing opening -- what `opening-tool.ts`
 * itself only creates. One click selects the opening under the pointer;
 * with one selected, a second click on its host wall replaces it with a
 * fresh rim at the clicked position, using whatever width/height/sill/kind
 * the tool's own params currently hold -- so adjusting a slider and
 * clicking again is how a resize happens, and clicking somewhere else along
 * the wall (without touching the sliders) is how a move happens. Delete or
 * Backspace, with a selection standing, removes it and restores the wall.
 *
 * Editing is always a full replace, never a nudge: `openingStructureType`'s
 * own role (`panel-structure.ts`) resolves every gesture to `"regenerate"`
 * for exactly this reason -- there is no meaningful "the same rim, moved a
 * little" on a rail that may be curved.
 */

const CHANNEL = "opening-edit";
const OVERLAP_COLOR = 0xef4444;

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
  ctx.runtime.clearPreview(CHANNEL);
}

/** The opening region under the pointer, if any -- the same pick-by-`surfaceRef` read `wallUnder` uses in `opening-tool.ts`, scoped to the opening's own surface type. */
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

export const openingEditTool: ConstructionTool<"opening-edit"> = {
  id: "opening-edit",
  defaultParams: () => DEFAULT_TOOL_PARAMS["opening-edit"],
  previewOnHover: true,

  previewFor(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext) {
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

    if (selected === undefined) {
      ctx.reportFeedback({ tone: "error", message: "Abertura: clique numa abertura existente para selecionar." });
      return;
    }

    const wall = ctx.runtime.getRegionTopology(selected.wallSurfaceKey);
    if (wall === undefined) {
      clearSelection(ctx);
      ctx.reportFeedback({ tone: "error", message: "A parede desta abertura nao existe mais." });
      return;
    }
    const rail = panelRailOf(ctx.runtime, wall) ?? selected.rail;
    const rim = rimCorners(rail, rail.travelTo(sample.point), params);
    if (rim === undefined) {
      ctx.reportFeedback({ tone: "error", message: "Abertura: nao cabe aqui." });
      return;
    }
    if (openingOverlapsSibling(rail, wall, rim.from, rim.to, rim.bottom, rim.top, selected.holeIndex)) {
      ctx.reportFeedback({ tone: "error", message: "Abertura: sobreporia outra abertura ja existente nesta parede." });
      return;
    }

    const causeId = scopedToolId(ctx, "opening-edit", ctx.nextSequence());
    const { recorded, error } = commitOpeningReplacement(
      ctx,
      causeId,
      { faceSurfaceKey: selected.openingSurfaceKey, wallSurfaceKey: selected.wallSurfaceKey, holeIndex: selected.holeIndex },
      { wallSurfaceKey: wall.surfaceKey, rail, from: rim.from, to: rim.to, bottom: rim.bottom, top: rim.top, openingKind: params.openingKind },
    );
    clearSelection(ctx);
    if (error !== undefined) {
      ctx.reportFeedback({ tone: "error", message: `Abertura: ${error}` });
      return;
    }
    if (recorded) ctx.history?.record({ kind: "transaction", transactionId: causeId });
    ctx.reportFeedback({ tone: "success", message: "Abertura movida/redimensionada." });
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
