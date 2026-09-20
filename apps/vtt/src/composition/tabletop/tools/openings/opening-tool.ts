import type { OpeningParams } from "@/features/edit-construction";
import type {
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait, openingStructureType, panelRailOf, type PanelRail } from "../../../../features/edit-construction/index.ts";

import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { findWallSurfaceAt } from "../walls/wall-shared.ts";
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

const OVERLAP_COLOR = 0xef4444;

/**
 * One tool for the whole life of an opening, matching the press-and-drag
 * model every other construction tool now shares
 * (`core/structure-edit-behavior.ts`): press on an *existing* door or
 * window and drag to move or resize it live; press anywhere else on a wall
 * to stamp a new one. Release commits -- unless nothing actually moved,
 * which leaves the opening merely selected (Delete/Backspace removes it,
 * restoring the wall). Not click-select-then-click-elsewhere: that model
 * left no way to start a second, independent opening while one was
 * selected, since *every* later click on the wall re-targeted the
 * selection instead of creating.
 *
 * Editing is always a full replace, never a nudge: `openingStructureType`'s
 * own role (`panel-structure.ts`) resolves every gesture to `"regenerate"`
 * for exactly this reason -- there is no meaningful "the same rim, moved a
 * little" on a rail that may be curved. That is also why this tool cannot
 * ride the generic `structure-edit-behavior.ts` grab (built for per-node
 * moves): it recomputes and replaces the whole rim itself, the same reason
 * terrain has its own `terrain-sculpt-tool.ts` instead.
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
}

/** The opening a plain click (no drag) last landed on -- kept around only so Delete/Backspace and the inspector have something to act on; never consulted by `onClick`'s create path, so it can never block placing a new one elsewhere. */
let selected: Selected | undefined;

interface Drag {
  readonly openingSurfaceKey: ConstructionSurfaceKey;
  readonly wallSurfaceKey: ConstructionSurfaceKey;
  readonly holeIndex: number;
  readonly originalSpan: { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number };
}

/** The opening currently being press-dragged, if any -- live for exactly one gesture. */
let drag: Drag | undefined;
/** Whether `onPointerDown` grabbed an opening this gesture, so the release's native `click` does not also run the create path. */
let grabbedThisGesture = false;

function clearSelection(ctx: ToolContext): void {
  selected = undefined;
  ctx.reportSelection(undefined);
}

/** The opening region under the pointer, if any -- the same pick-by-`surfaceRef` read `wallUnder` uses below, scoped to the opening's own surface type so clicking a placed window never gets read as clicking the wall behind it. */
function openingUnder(ctx: ToolContext, sample: PointerSample): ConstructionRegionTopology | undefined {
  const picked = sample.surfaceRef;
  if (picked === undefined) return undefined;
  return ctx.runtime
    .getAllRegionTopologies()
    .find((topology) => topology.surfaceType === openingStructureType.surfaceType && surfaceRefFromNodeSet(topology.surfaceKey) === picked);
}

/** Starts a drag on `opening`, if it can be read as a rail-mounted rim -- `false` when its host wall cannot be found, leaving the gesture to fall through to placement. */
function beginGrab(ctx: ToolContext, opening: ConstructionRegionTopology): boolean {
  const host = hostWallOf(ctx, opening);
  if (host === undefined) return false;
  const rail = panelRailOf(ctx.runtime, host.wall);
  if (rail === undefined) return false;
  const span = openingSpan(rail, opening);
  if (span === undefined) return false;
  selected = { openingSurfaceKey: opening.surfaceKey, wallSurfaceKey: host.wall.surfaceKey, holeIndex: host.holeIndex };
  drag = { openingSurfaceKey: opening.surfaceKey, wallSurfaceKey: host.wall.surfaceKey, holeIndex: host.holeIndex, originalSpan: span };
  const center = rail.positionAt((span.from + span.to) / 2, (span.bottom + span.top) / 2);
  ctx.reportSelection({ id: surfaceRefFromNodeSet(opening.surfaceKey), point: center });
  return true;
}

/** The live move/resize preview for the opening being dragged, at the pointer's current spot on its host wall. */
function dragPreview(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext, active: Drag): ReturnType<typeof segmentsPreview> | undefined {
  const wall = ctx.runtime.getRegionTopology(active.wallSurfaceKey);
  if (wall === undefined) return undefined;
  const rail = panelRailOf(ctx.runtime, wall);
  if (rail === undefined) return undefined;
  const rim = rimCorners(rail, rail.travelTo(gesture.current.point), params);
  if (rim === undefined) return undefined;
  const overlaps = openingOverlapsSibling(rail, wall, rim.from, rim.to, rim.bottom, rim.top, active.holeIndex);
  const ring = [...rim.corners, rim.corners[0]!];
  const positions: number[] = [];
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const from = ring[index]!;
    const to = ring[index + 1]!;
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  }
  return segmentsPreview(Float32Array.from(positions), overlaps ? OVERLAP_COLOR : OPENING_COLOR[params.openingKind]);
}

/** Commits the drag's move/resize to wherever it was released -- a no-op (kept selected, not committed) when the rim never actually changed, so a plain click just selects. */
function commitDrag(ctx: ToolContext, gesture: ToolGesture, params: OpeningParams, active: Drag): void {
  const wall = ctx.runtime.getRegionTopology(active.wallSurfaceKey);
  if (wall === undefined) {
    clearSelection(ctx);
    ctx.reportFeedback({ tone: "error", message: "A parede desta abertura nao existe mais." });
    return;
  }
  const rail = panelRailOf(ctx.runtime, wall);
  if (rail === undefined) {
    ctx.reportFeedback({ tone: "error", message: "A parede desta abertura nao existe mais." });
    return;
  }
  const rim = rimCorners(rail, rail.travelTo(gesture.current.point), params);
  if (rim === undefined) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: nao cabe aqui." });
    return;
  }

  const EPS = 1e-6;
  const unchanged =
    Math.abs(rim.from - active.originalSpan.from) < EPS &&
    Math.abs(rim.to - active.originalSpan.to) < EPS &&
    Math.abs(rim.bottom - active.originalSpan.bottom) < EPS &&
    Math.abs(rim.top - active.originalSpan.top) < EPS;
  if (unchanged) {
    ctx.reportFeedback({ tone: "info", message: "Abertura selecionada. Arraste para mover ou redimensionar; ajuste largura/altura/peitoril e arraste de novo; Delete apaga." });
    return;
  }

  if (openingOverlapsSibling(rail, wall, rim.from, rim.to, rim.bottom, rim.top, active.holeIndex)) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: sobreporia outra abertura ja existente nesta parede." });
    return;
  }

  const causeId = scopedToolId(ctx, "opening-edit", ctx.nextSequence());
  const { recorded, error } = commitOpeningReplacement(
    ctx,
    causeId,
    { faceSurfaceKey: active.openingSurfaceKey, wallSurfaceKey: active.wallSurfaceKey, holeIndex: active.holeIndex },
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
    if (drag !== undefined) return dragPreview(gesture, params, ctx, drag);
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

  /** Press on an existing opening starts a drag (see `beginGrab`); press anywhere else leaves the gesture to `onClick`'s create path below. */
  onPointerDown(ctx: ToolContext, sample: PointerSample): void {
    drag = undefined;
    grabbedThisGesture = false;
    const opening = openingUnder(ctx, sample);
    if (opening === undefined) return;
    if (beginGrab(ctx, opening)) {
      grabbedThisGesture = true;
    } else {
      ctx.reportFeedback({ tone: "error", message: "Nao foi possivel identificar a parede desta abertura." });
    }
  },

  // No-op: `previewFor` already redraws the live ghost every move via the
  // dispatcher's own throttle; the actual rim replace only happens once, on
  // release, matching every other tool's single-commit-per-gesture shape.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: OpeningParams): void {
    if (drag === undefined) return;
    const active = drag;
    drag = undefined;
    commitDrag(ctx, gesture, params, active);
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
    // A press+release that grabbed an existing opening already ran through
    // `onPointerUp` above (selecting it, or committing its move/resize) --
    // this trailing native click must never also try to stamp a new one.
    if (grabbedThisGesture) {
      grabbedThisGesture = false;
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
    const wall = ctx.runtime.getRegionTopology(placed.surfaceKey);
    if (wall === undefined) return;
    if (openingOverlapsSibling(placed.rail, wall, placed.from, placed.to, placed.bottom, placed.top)) {
      ctx.reportFeedback({ tone: "error", message: "Abertura: sobreporia outra abertura ja existente nesta parede." });
      return;
    }

    const causeId = scopedToolId(ctx, "opening", ctx.nextSequence());
    const { recorded, error } = commitOpeningReplacement(ctx, causeId, undefined, {
      wallSurfaceKey: placed.surfaceKey,
      rail: placed.rail,
      from: placed.from,
      to: placed.to,
      bottom: placed.bottom,
      top: placed.top,
      openingKind: params.openingKind,
    });
    if (error !== undefined) {
      ctx.reportFeedback({ tone: "error", message: `Abertura: ${error}` });
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
    drag = undefined;
    clearSelection(ctx);
  },
};

interface Placement {
  readonly surfaceKey: ConstructionSurfaceKey;
  readonly corners: readonly ConstructionPosition[];
  readonly rail: PanelRail;
  readonly from: number;
  readonly to: number;
  readonly bottom: number;
  readonly top: number;
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
  return placed === undefined
    ? undefined
    : { surfaceKey, corners: placed.corners, rail, from: placed.from, to: placed.to, bottom: placed.bottom, top: placed.top };
}
