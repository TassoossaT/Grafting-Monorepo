import type { OpeningParams } from "@/features/edit-construction";
import type {
  ConstructionHostPoint,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { DEFAULT_TOOL_PARAMS, hasTrait, openingStructureType } from "../../../../features/edit-construction/index.ts";

import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { findWallSurfaceAt } from "../walls/wall-shared.ts";
import {
  clampRect,
  commitOpeningReplacement,
  hostFrame,
  hostsOf,
  isDoorRect,
  overlapsSibling,
  primaryHostOf,
  rectLoop,
  spanOn,
  type HostFrame,
  type HostRect,
} from "./opening-shared.ts";

export const OPENING_COLOR: Record<OpeningParams["openingKind"], number> = {
  window: 0x7dd3fc,
  door: 0xd97706,
};

const OVERLAP_COLOR = 0xef4444;

/**
 * One tool for the whole life of an opening. Press on an existing door or
 * window and drag: the body moves it, an edge or a corner resizes it.
 * Press on bare wall and drag to draw a new one; a plain click places one
 * at the slider size. Release commits unless nothing changed, which only
 * selects (Delete removes it; a plain click on an already-selected opening
 * applies the sliders' width/height).
 *
 * Everything is computed in the host face's `(u, v)` frame, so a curved or
 * slanted host is followed rather than spanned, and editing is always a full
 * replace of the opening region (see `openingStructureType`'s policy).
 */

interface Selected {
  readonly openingSurfaceKey: ConstructionSurfaceKey;
}

let selected: Selected | undefined;

/** Which side of each axis a press grabbed. Neither = the body; one = an edge; both = a corner. */
interface GrabHandle {
  readonly u?: "left" | "right";
  readonly v?: "top" | "bottom";
}

/** How close (world units) a press must land to a rim edge to grab that edge instead of the body. */
const HANDLE_TOLERANCE = 0.12;
/** The smallest world width or height a drawn or dragged opening may settle at. */
const MIN_OPENING_SIZE = 0.3;
/** How far (world units) a press must travel to count as drawing a size rather than clicking. */
const CREATE_DRAG_THRESHOLD = 0.05;
/** How far off an opening's own face a point may land and still count as on it. */
const OPENING_PICK_TOLERANCE = 0.2;
const PREVIEW_SIDE_STEPS = 8;

function handleAt(frame: HostFrame, span: HostRect, at: ConstructionHostPoint): GrabHandle {
  const tolU = HANDLE_TOLERANCE / frame.length;
  const tolV = HANDLE_TOLERANCE / frame.heightAt((span.u0 + span.u1) / 2);
  return {
    u: Math.abs(at.u - span.u0) <= tolU ? "left" : Math.abs(at.u - span.u1) <= tolU ? "right" : undefined,
    v: Math.abs(at.v - span.v1) <= tolV ? "top" : Math.abs(at.v - span.v0) <= tolV ? "bottom" : undefined,
  };
}

/** A press on one of the rim's own node dots always means the nearer corner. */
function cornerAt(span: HostRect, at: ConstructionHostPoint): GrabHandle {
  return {
    u: Math.abs(at.u - span.u0) <= Math.abs(at.u - span.u1) ? "left" : "right",
    v: Math.abs(at.v - span.v0) <= Math.abs(at.v - span.v1) ? "bottom" : "top",
  };
}

function isBody(handle: GrabHandle): boolean {
  return handle.u === undefined && handle.v === undefined;
}

interface Drag {
  readonly openingSurfaceKey: ConstructionSurfaceKey;
  readonly hostSurfaceKey: ConstructionSurfaceKey;
  readonly originalSpan: HostRect;
  readonly handle: GrabHandle;
  readonly isDoor: boolean;
  /** The `(u, v)` size a body drag carries: the opening's own, or the sliders' when it was already selected. */
  readonly du: number;
  readonly dv: number;
  /** Offset from the grab point to the opening's center, so a body drag never jumps. */
  readonly grabOffset: { readonly u: number; readonly v: number };
}

let drag: Drag | undefined;
/** Whether `onPointerDown` grabbed an opening this gesture, so the trailing `click` does not also create. */
let grabbedThisGesture = false;

interface CreateAnchor {
  readonly hostSurfaceKey: ConstructionSurfaceKey;
  readonly u: number;
  readonly v: number;
}
let creating: CreateAnchor | undefined;
/** Whether `onPointerUp` already placed a drawn opening, so the trailing `click` does not stamp a second. */
let createdThisGesture = false;

function clearSelection(ctx: ToolContext): void {
  selected = undefined;
  ctx.reportSelection(undefined);
}

function isOpening(topology: ConstructionRegionTopology): boolean {
  return topology.surfaceType === openingStructureType.surfaceType;
}

function projectOne(frame: HostFrame, point: ConstructionPosition): ConstructionHostPoint | undefined {
  try {
    return frame.project([point])[0];
  } catch {
    return undefined;
  }
}

/** The closest opening whose face contains `point` -- the fallback when the renderer's pick missed a thin, non-physical face. */
function openingNear(ctx: ToolContext, point: ConstructionPosition): ConstructionRegionTopology | undefined {
  let best: { readonly topology: ConstructionRegionTopology; readonly distance: number } | undefined;
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    if (!isOpening(topology)) continue;
    const hostKey = primaryHostOf(topology);
    const frame = hostKey === undefined ? undefined : hostFrame(ctx.runtime, hostKey);
    if (frame === undefined) continue;
    const span = spanOn(frame, topology);
    const at = projectOne(frame, point);
    if (span === undefined || at === undefined) continue;
    if (at.u < span.u0 || at.u > span.u1 || at.v < span.v0 || at.v > span.v1) continue;
    const [onFace] = frame.resolve([[at.u, at.v]]);
    const distance = Math.hypot(point.x - onFace!.x, point.y - onFace!.y, point.z - onFace!.z);
    if (distance > OPENING_PICK_TOLERANCE) continue;
    if (best === undefined || distance < best.distance) best = { topology, distance };
  }
  return best?.topology;
}

function isRimNode(opening: ConstructionRegionTopology, nodeId: string | undefined): boolean {
  return nodeId !== undefined && opening.nodes.some((node) => node.id === nodeId);
}

/** The opening under the pointer: a rim dot, then the pick, then `openingNear`. */
function openingUnder(ctx: ToolContext, sample: PointerSample): ConstructionRegionTopology | undefined {
  const topologies = ctx.runtime.getAllRegionTopologies();
  if (sample.nodeId !== undefined) {
    const owner = topologies.find((topology) => isOpening(topology) && isRimNode(topology, sample.nodeId));
    if (owner !== undefined) return owner;
  }
  const picked = sample.surfaceRef;
  if (picked !== undefined) {
    const hit = topologies.find((topology) => isOpening(topology) && surfaceRefFromNodeSet(topology.surfaceKey) === picked);
    if (hit !== undefined) return hit;
  }
  return openingNear(ctx, sample.point);
}

/** Rounds a world height to a small step, absorbing sub-pixel pick noise that would make the hover ghost flicker. */
function snapped(value: number): number {
  const step = 0.02;
  return Math.round(value / step) * step;
}

/**
 * Starts a drag on `opening`. Its own size is carried, never the sliders' --
 * except on an opening that is already this tool's selection, where a second
 * press means "apply the sliders now". An opening pinned to several hosts is
 * only selected: its edits would need every host's frame at once.
 */
function beginGrab(ctx: ToolContext, opening: ConstructionRegionTopology, sample: PointerSample, liveParams: OpeningParams): boolean {
  const hostKey = primaryHostOf(opening);
  if (hostKey === undefined) return false;
  const frame = hostFrame(ctx.runtime, hostKey);
  if (frame === undefined) return false;
  const span = spanOn(frame, opening);
  const at = projectOne(frame, sample.point);
  if (span === undefined || at === undefined) return false;

  const alreadySelected = selected !== undefined && surfaceRefFromNodeSet(selected.openingSurfaceKey) === surfaceRefFromNodeSet(opening.surfaceKey);
  selected = { openingSurfaceKey: opening.surfaceKey };
  const centerU = (span.u0 + span.u1) / 2;
  const centerV = (span.v0 + span.v1) / 2;
  const [center] = frame.resolve([[centerU, centerV]]);
  ctx.reportSelection({ id: surfaceRefFromNodeSet(opening.surfaceKey), point: center! });

  if (hostsOf(opening).size > 1) {
    drag = undefined;
    return true;
  }

  drag = {
    openingSurfaceKey: opening.surfaceKey,
    hostSurfaceKey: hostKey,
    originalSpan: span,
    handle: isRimNode(opening, sample.nodeId) ? cornerAt(span, at) : handleAt(frame, span, at),
    isDoor: isDoorRect(span),
    du: alreadySelected ? liveParams.width / frame.length : span.u1 - span.u0,
    dv: alreadySelected ? liveParams.height / frame.heightAt(centerU) : span.v1 - span.v0,
    grabOffset: { u: at.u - centerU, v: at.v - centerV },
  };
  return true;
}

/** Where `active`'s opening would stand, before clamping, if released at `at`. */
function rawRectFor(frame: HostFrame, active: Drag, at: ConstructionHostPoint): HostRect {
  const { originalSpan: span, handle } = active;
  if (!isBody(handle)) {
    const minU = MIN_OPENING_SIZE / frame.length;
    const minV = MIN_OPENING_SIZE / frame.heightAt((span.u0 + span.u1) / 2);
    let { u0, u1, v0, v1 } = span;
    if (handle.u === "left") u0 = Math.min(at.u, span.u1 - minU);
    if (handle.u === "right") u1 = Math.max(at.u, span.u0 + minU);
    if (handle.v === "top") v1 = Math.max(at.v, span.v0 + minV);
    // A door's floor sill never moves.
    if (handle.v === "bottom" && !active.isDoor) v0 = Math.min(at.v, span.v1 - minV);
    return { u0, u1, v0, v1 };
  }
  const centerU = at.u - active.grabOffset.u;
  const v0 = active.isDoor ? 0 : at.v - active.grabOffset.v - active.dv / 2;
  return { u0: centerU - active.du / 2, u1: centerU + active.du / 2, v0, v1: v0 + active.dv };
}

function sameRect(a: HostRect, b: HostRect): boolean {
  const EPS = 1e-9;
  return Math.abs(a.u0 - b.u0) < EPS && Math.abs(a.u1 - b.u1) < EPS && Math.abs(a.v0 - b.v0) < EPS && Math.abs(a.v1 - b.v1) < EPS;
}

/** A closed-ring preview of `rect`, resolved on the host so a slanted or curved face shows the deformed shape. */
function ringPreview(frame: HostFrame, rect: HostRect, color: number): ReturnType<typeof segmentsPreview> {
  const ring = frame.resolve(rectLoop(frame, rect, PREVIEW_SIDE_STEPS));
  const positions: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const from = ring[index]!;
    const to = ring[(index + 1) % ring.length]!;
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  }
  return segmentsPreview(Float32Array.from(positions), color);
}

function dragPreview(gesture: ToolGesture, ctx: ToolContext, active: Drag): ReturnType<typeof segmentsPreview> | undefined {
  const frame = hostFrame(ctx.runtime, active.hostSurfaceKey);
  const at = frame === undefined ? undefined : projectOne(frame, gesture.current.point);
  if (frame === undefined || at === undefined) return undefined;
  const rect = clampRect(frame, rawRectFor(frame, active, at), active.isDoor);
  if (rect === undefined) return undefined;
  const overlaps = overlapsSibling(ctx, frame, rect, active.openingSurfaceKey);
  return ringPreview(frame, rect, overlaps ? OVERLAP_COLOR : OPENING_COLOR[active.isDoor ? "door" : "window"]);
}

function reportCommit(ctx: ToolContext, causeId: string, result: { readonly recorded: boolean; readonly error?: string }, success: string): void {
  if (result.error !== undefined) {
    ctx.reportFeedback({ tone: "error", message: `Abertura: ${result.error}` });
    return;
  }
  if (result.recorded) ctx.history?.record({ kind: "transaction", transactionId: causeId });
  ctx.reportFeedback({ tone: "success", message: success });
}

const OVERLAP_MESSAGE = "Abertura: sobreporia outra abertura ja existente nesta parede.";
const NO_FIT_MESSAGE = "Abertura: nao cabe aqui.";
const HOST_GONE_MESSAGE = "A parede desta abertura nao existe mais.";

function commitDrag(ctx: ToolContext, gesture: ToolGesture, active: Drag): void {
  const frame = hostFrame(ctx.runtime, active.hostSurfaceKey);
  if (frame === undefined) {
    clearSelection(ctx);
    ctx.reportFeedback({ tone: "error", message: HOST_GONE_MESSAGE });
    return;
  }
  const at = projectOne(frame, gesture.current.point);
  if (at === undefined) {
    ctx.reportFeedback({ tone: "error", message: NO_FIT_MESSAGE });
    return;
  }
  const raw = rawRectFor(frame, active, at);
  if (sameRect(raw, active.originalSpan)) {
    ctx.reportFeedback({ tone: "info", message: "Abertura selecionada. Arraste o meio para mover, uma borda ou um canto para redimensionar; Delete apaga." });
    return;
  }
  const rect = clampRect(frame, raw, active.isDoor);
  if (rect === undefined) {
    ctx.reportFeedback({ tone: "error", message: NO_FIT_MESSAGE });
    return;
  }
  if (sameRect(rect, active.originalSpan)) return;
  if (overlapsSibling(ctx, frame, rect, active.openingSurfaceKey)) {
    ctx.reportFeedback({ tone: "error", message: OVERLAP_MESSAGE });
    return;
  }
  const causeId = scopedToolId(ctx, "opening-edit", ctx.nextSequence());
  const result = commitOpeningReplacement(ctx, causeId, active.openingSurfaceKey, { frame, rect });
  clearSelection(ctx);
  reportCommit(ctx, causeId, result, isBody(active.handle) ? "Abertura movida." : "Abertura redimensionada.");
}

/** The rect drawn from `anchor` to `at`, both read as opposite corners. */
function drawnRect(frame: HostFrame, isDoor: boolean, anchor: CreateAnchor, at: ConstructionHostPoint): HostRect | undefined {
  const u0 = Math.min(anchor.u, at.u), u1 = Math.max(anchor.u, at.u);
  const v0 = Math.min(anchor.v, at.v), v1 = Math.max(anchor.v, at.v);
  if ((u1 - u0) * frame.length < MIN_OPENING_SIZE) return undefined;
  if ((v1 - v0) * frame.heightAt((u0 + u1) / 2) < MIN_OPENING_SIZE) return undefined;
  return clampRect(frame, isDoor ? { u0, u1, v0: 0, v1: v1 - v0 } : { u0, u1, v0, v1 }, isDoor);
}

function createPreview(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext, anchor: CreateAnchor): ReturnType<typeof segmentsPreview> | undefined {
  const frame = hostFrame(ctx.runtime, anchor.hostSurfaceKey);
  const at = frame === undefined ? undefined : projectOne(frame, gesture.current.point);
  if (frame === undefined || at === undefined) return undefined;
  const rect = drawnRect(frame, params.openingKind === "door", anchor, at);
  if (rect === undefined) return undefined;
  return ringPreview(frame, rect, overlapsSibling(ctx, frame, rect) ? OVERLAP_COLOR : OPENING_COLOR[params.openingKind]);
}

function placeNew(ctx: ToolContext, frame: HostFrame, rect: HostRect | undefined, kind: OpeningParams["openingKind"]): void {
  if (rect === undefined) {
    ctx.reportFeedback({ tone: "error", message: NO_FIT_MESSAGE });
    return;
  }
  if (overlapsSibling(ctx, frame, rect)) {
    ctx.reportFeedback({ tone: "error", message: OVERLAP_MESSAGE });
    return;
  }
  const causeId = scopedToolId(ctx, "opening", ctx.nextSequence());
  const result = commitOpeningReplacement(ctx, causeId, undefined, { frame, rect });
  reportCommit(ctx, causeId, result, kind === "door" ? "Porta aberta na parede." : "Janela aberta na parede.");
}

export const openingTool: ConstructionTool<"opening"> = {
  id: "opening",
  defaultParams: () => DEFAULT_TOOL_PARAMS.opening,
  previewOnHover: true,
  // Placement is read in the host's own frame, never off raw world X/Z, so
  // the dispatcher's world-grid magnet must not round the pointer first.
  snapsToSurface: true,

  previewFor(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext) {
    if (drag !== undefined) return dragPreview(gesture, ctx, drag);
    if (creating !== undefined) return createPreview(gesture, params, ctx, creating);
    const placed = resolvePlacement(ctx, gesture.current, params);
    if (placed?.rect === undefined) return undefined;
    return ringPreview(placed.frame, placed.rect, OPENING_COLOR[params.openingKind]);
  },

  onPointerDown(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
    drag = undefined;
    creating = undefined;
    grabbedThisGesture = false;
    createdThisGesture = false;
    const opening = openingUnder(ctx, sample);
    if (opening !== undefined) {
      if (beginGrab(ctx, opening, sample, params)) grabbedThisGesture = true;
      else ctx.reportFeedback({ tone: "error", message: "Nao foi possivel identificar a parede desta abertura." });
      return;
    }
    const hostSurfaceKey = wallUnder(ctx, sample);
    const frame = hostSurfaceKey === undefined ? undefined : hostFrame(ctx.runtime, hostSurfaceKey);
    const at = frame === undefined ? undefined : projectOne(frame, sample.point);
    if (hostSurfaceKey === undefined || at === undefined) return;
    creating = { hostSurfaceKey, u: at.u, v: at.v };
  },

  // The ghost is redrawn by `previewFor`; the commit happens once, on release.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: OpeningParams): void {
    if (drag !== undefined) {
      const active = drag;
      drag = undefined;
      commitDrag(ctx, gesture, active);
      return;
    }
    if (creating === undefined) return;
    const anchor = creating;
    creating = undefined;
    const { start, current } = gesture;
    const moved = Math.hypot(current.point.x - start.point.x, current.point.y - start.point.y, current.point.z - start.point.z) > CREATE_DRAG_THRESHOLD;
    // A plain click is left to `onClick`, which stamps the slider size.
    if (!moved) return;
    createdThisGesture = true;
    const frame = hostFrame(ctx.runtime, anchor.hostSurfaceKey);
    const at = frame === undefined ? undefined : projectOne(frame, current.point);
    if (frame === undefined || at === undefined) return;
    placeNew(ctx, frame, drawnRect(frame, params.openingKind === "door", anchor, at), params.openingKind);
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
    if (grabbedThisGesture) {
      grabbedThisGesture = false;
      return;
    }
    if (createdThisGesture) {
      createdThisGesture = false;
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
    placeNew(ctx, placed.frame, placed.rect, params.openingKind);
  },

  onDeleteKey(ctx: ToolContext): void {
    if (selected === undefined) return;
    const causeId = scopedToolId(ctx, "opening-edit-delete", ctx.nextSequence());
    const result = commitOpeningReplacement(ctx, causeId, selected.openingSurfaceKey, undefined);
    clearSelection(ctx);
    reportCommit(ctx, causeId, result, "Abertura removida; parede restaurada.");
  },

  onCancel(ctx: ToolContext): void {
    drag = undefined;
    creating = undefined;
    clearSelection(ctx);
  },
};

/**
 * Which face the pointer is on: the renderer's pick first, the straight-run
 * fallback for a pointer that resolved to ground. Only faces that accept
 * cuts, so an already-placed opening never reads as a host for a nested one.
 */
function wallUnder(ctx: ToolContext, sample: PointerSample): ConstructionSurfaceKey | undefined {
  const picked = sample.surfaceRef;
  if (picked !== undefined) {
    const hit = ctx.runtime
      .getAllRegionTopologies()
      .find((topology) => hasTrait(topology.surfaceType, "accepts-cuts") && surfaceRefFromNodeSet(topology.surfaceKey) === picked);
    if (hit !== undefined) return hit.surfaceKey;
  }
  return findWallSurfaceAt(ctx, sample.point);
}

/** The face under the pointer with a slider-sized opening centered on the click, its bottom at the clicked height -- `rect` undefined when it will not fit. */
function resolvePlacement(
  ctx: ToolContext,
  sample: PointerSample,
  params: OpeningParams,
): { readonly frame: HostFrame; readonly rect: HostRect | undefined } | undefined {
  const hostSurfaceKey = wallUnder(ctx, sample);
  const frame = hostSurfaceKey === undefined ? undefined : hostFrame(ctx.runtime, hostSurfaceKey);
  const at = frame === undefined ? undefined : projectOne(frame, sample.point);
  if (frame === undefined || at === undefined) return undefined;
  const height = frame.heightAt(Math.max(0, Math.min(1, at.u)));
  if (!(height > 0)) return { frame, rect: undefined };
  const du = params.width / frame.length;
  const dv = params.height / height;
  const isDoor = params.openingKind === "door";
  const v0 = isDoor ? 0 : snapped(at.v * height) / height;
  return { frame, rect: clampRect(frame, { u0: at.u - du / 2, u1: at.u + du / 2, v0, v1: v0 + dv }, isDoor) };
}
