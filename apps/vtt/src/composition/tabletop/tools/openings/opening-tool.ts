import type { OpeningParams, OpeningShape } from "@/features/edit-construction";
import type {
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { DEFAULT_TOOL_PARAMS, OPENING_KIND_COLOR, RECTANGLE_OPENING_SHAPE, hasTrait, openingStructureType, sameShape } from "../../../../features/edit-construction/index.ts";

import { gestureMoved, scopedToolId, type ConstructionTool, type PointerSample, type ReleasedGesture, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { findWallSurfaceAt } from "../walls/wall-shared.ts";
import { openingStands } from "../opening-stands.ts";
import type { OpeningStand, StandLook, StandPlacement } from "./opening-stand.ts";
import {
  commitOpeningGroup,
  groupIdOf,
  groupPieces,
  groupRunSpan,
  hostBoxOf,
  isDoorRect,
  MIN_OPENING_SIZE,
  overlapsOther,
  piecePolyline,
  primaryHostOf,
  runFrame,
  settleRect,
  shapeOfGroup,
  type OpeningPiece,
  type RunFrame,
  type RunRect,
} from "./opening-shared.ts";

const OVERLAP_COLOR = 0xef4444;

/**
 * One tool for the whole life of an opening. Press on an existing door or
 * window and drag: the body moves it, an edge or a corner resizes it.
 * Press on bare wall and drag to draw a new one; a plain click places one
 * at the slider size. A plain click on an opening selects it and shows its
 * size and shape in the panel (Delete removes it); a plain click on the
 * opening already selected applies the sliders' width/height to it.
 *
 * Everything is computed in the run's `(s, v)` frame -- the chain of faces
 * the pressed one continues -- so an opening follows a curved or slanted
 * wall and straddles its seams; each commit splits the rect into one piece
 * per face and replaces the whole group (see `openingStructureType`).
 */

interface Selected {
  readonly groupKey: string;
  readonly pieceKeys: readonly ConstructionSurfaceKey[];
  readonly shape: OpeningShape;
}

let selected: Selected | undefined;

/** What the params panel shows of an opening. */
type OpeningLook = Pick<OpeningParams, "width" | "height" | "shape">;
/**
 * While an opening is selected the params panel shows and edits ITS look;
 * this keeps the look the next new opening gets, put back on deselect.
 */
let lookForNew: OpeningLook | undefined;

function shapeOf(params: Pick<OpeningParams, "shape">): OpeningShape {
  return params.shape ?? RECTANGLE_OPENING_SHAPE;
}

function lookOf(params: OpeningLook): OpeningLook {
  return { width: params.width, height: params.height, shape: shapeOf(params) };
}

function sameLook(a: OpeningLook, b: OpeningLook): boolean {
  return Math.abs(a.width - b.width) < 1e-9 && Math.abs(a.height - b.height) < 1e-9 && sameShape(a.shape, b.shape);
}

/** `params` as a new opening takes them, whatever the panel shows for a selection. */
function forNew(params: OpeningParams): OpeningParams {
  return lookForNew === undefined ? params : { ...params, ...lookForNew };
}

function select(ctx: ToolContext, next: Selected, look: OpeningLook, params: OpeningParams): void {
  lookForNew ??= lookOf(params);
  selected = next;
  if (!sameLook(lookOf(params), look)) ctx.updateToolParams?.("opening", (current) => ({ ...current, ...look }));
}

function clearSelection(ctx: ToolContext): void {
  selected = undefined;
  ctx.reportSelection(undefined);
  const restore = lookForNew;
  lookForNew = undefined;
  if (restore !== undefined) ctx.updateToolParams?.("opening", (current) => (sameLook(lookOf(current), restore) ? current : { ...current, ...restore }));
}

/** Which side of each axis a press grabbed. Neither = the body; one = an edge; both = a corner. */
interface GrabHandle {
  readonly s?: "left" | "right";
  readonly v?: "top" | "bottom";
}

/** How close (world units) a press must land to a rim edge to grab that edge instead of the body. */
const HANDLE_TOLERANCE = 0.12;
/** How far off an opening's own face a point may land and still count as on it. */
const OPENING_PICK_TOLERANCE = 0.2;
/** The longest straight step (world units) a preview ring takes along a curved face. */
const PREVIEW_STEP = 0.15;

interface RunPoint {
  readonly s: number;
  readonly v: number;
}

/** The handle under `at`, found by geometry against the opening's box. */
function handleAt(run: RunFrame, span: RunRect, at: RunPoint): GrabHandle {
  const tolV = HANDLE_TOLERANCE / run.heightAt((span.s0 + span.s1) / 2);
  return {
    s: Math.abs(at.s - span.s0) <= HANDLE_TOLERANCE ? "left" : Math.abs(at.s - span.s1) <= HANDLE_TOLERANCE ? "right" : undefined,
    v: Math.abs(at.v - span.v1) <= tolV ? "top" : Math.abs(at.v - span.v0) <= tolV ? "bottom" : undefined,
  };
}

function isBody(handle: GrabHandle): boolean {
  return handle.s === undefined && handle.v === undefined;
}

interface Drag {
  readonly run: RunFrame;
  readonly pieceKeys: readonly ConstructionSurfaceKey[];
  readonly pieceRefs: ReadonlySet<string>;
  readonly originalSpan: RunRect;
  readonly handle: GrabHandle;
  readonly isDoor: boolean;
  readonly shape: OpeningShape;
  /** Whether the group was already this tool's selection when pressed: a plain click then applies the sliders. */
  readonly wasSelected: boolean;
  /** Offset from the grab point to the opening's center, so a body drag never jumps. */
  readonly grabOffset: RunPoint;
  /** The face the opening is pinned to. */
  readonly hostSurfaceKey: ConstructionSurfaceKey;
  /** The stand that face is, when it was raised for this opening: it follows every edit. */
  readonly stand?: OpeningStand;
  /** In a stand, the opening's sill and top in the world. */
  readonly world?: { readonly bottom: number; readonly top: number };
}

interface CreateAnchor extends RunPoint {
  readonly run: RunFrame;
  readonly hostSurfaceKey: ConstructionSurfaceKey;
}

/** What the current press landed on: an opening it grabbed, or bare wall (or nothing) to create on. */
type Press =
  | { readonly kind: "grab"; readonly drag: Drag }
  | { readonly kind: "wall"; readonly anchor: CreateAnchor | undefined }
  | { readonly kind: "stand"; readonly stand: OpeningStand; readonly face: ConstructionRegionTopology; readonly at: ConstructionPosition };

let press: Press | undefined;

function isOpening(topology: ConstructionRegionTopology): boolean {
  return topology.surfaceType === openingStructureType.surfaceType;
}

/**
 * The closest opening whose box holds `point`, or whose rim it lands within
 * a handle's reach of. The renderer picks an opening's pane, but its handles
 * live on its bounding box: a press just outside the rim, or on an edge or
 * corner of a rounded opening outside its pane, reports the wall.
 */
function openingNear(ctx: ToolContext, point: ConstructionPosition): ConstructionRegionTopology | undefined {
  let best: { readonly topology: ConstructionRegionTopology; readonly distance: number } | undefined;
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    if (!isOpening(topology)) continue;
    const hostSurfaceKey = primaryHostOf(topology);
    if (hostSurfaceKey === undefined) continue;
    const box = hostBoxOf(topology, hostSurfaceKey);
    if (box === undefined) continue;
    let inside, onBox;
    try {
      const [at] = ctx.runtime.projectToHost({ hostSurfaceKey, points: [point] });
      const u = Math.max(box.u0, Math.min(box.u1, at!.u));
      const v = Math.max(box.v0, Math.min(box.v1, at!.v));
      inside = u === at!.u && v === at!.v;
      [onBox] = ctx.runtime.resolveOnHost({ hostSurfaceKey, uv: [[u, v]] });
    } catch {
      continue;
    }
    const distance = Math.hypot(point.x - onBox!.x, point.y - onBox!.y, point.z - onBox!.z);
    if (distance > (inside ? OPENING_PICK_TOLERANCE : HANDLE_TOLERANCE)) continue;
    if (best === undefined || distance < best.distance) best = { topology, distance };
  }
  return best?.topology;
}

/** The opening under the pointer: the pick, then `openingNear`. */
function openingUnder(ctx: ToolContext, sample: PointerSample): ConstructionRegionTopology | undefined {
  const picked = sample.surfaceRef;
  if (picked !== undefined) {
    const hit = ctx.runtime.getAllRegionTopologies().find((topology) => isOpening(topology) && surfaceRefFromNodeSet(topology.surfaceKey) === picked);
    if (hit !== undefined) return hit;
  }
  return openingNear(ctx, sample.point);
}

/** Rounds a world height to a small step, absorbing sub-pixel pick noise that would make the hover ghost flicker. */
function snapped(value: number): number {
  const step = 0.02;
  return Math.round(value / step) * step;
}

/** The run a sample's face belongs to, and where on it the sample lands. */
function runPointAt(ctx: ToolContext, hostSurfaceKey: ConstructionSurfaceKey, point: ConstructionPosition): { readonly run: RunFrame; readonly at: RunPoint } | undefined {
  const run = runFrame(ctx.runtime, hostSurfaceKey);
  const at = run?.project(point, hostSurfaceKey);
  return run === undefined || at === undefined ? undefined : { run, at };
}

/** Grabs `opening`'s whole group and selects it; a group not selected yet shows its own size and shape in the panel. */
function beginGrab(ctx: ToolContext, opening: ConstructionRegionTopology, sample: PointerSample, params: OpeningParams): Drag | undefined {
  const group = groupIdOf(opening);
  const hostKey = primaryHostOf(opening);
  const placed = hostKey === undefined ? undefined : runPointAt(ctx, hostKey, sample.point);
  if (group === undefined || placed === undefined) return undefined;
  const { run, at } = placed;
  const pieces = groupPieces(ctx, group);
  const span = groupRunSpan(run, pieces);
  if (span === undefined) return undefined;

  const wasSelected = selected?.groupKey === group;
  const pieceKeys = pieces.map((piece) => piece.surfaceKey);
  const shape = shapeOfGroup(pieces);
  const centerS = (span.s0 + span.s1) / 2;
  const centerV = (span.v0 + span.v1) / 2;
  const held = standOf(ctx, hostKey!);
  // In a stand's front the opening is measured in the world: the front's
  // local height rises under a gable, so its `v` says nothing of its size.
  const ys = pieces.flatMap((piece) => piece.nodes.map((node) => node.position.y));
  const world = held.stand === undefined ? undefined : { bottom: Math.min(...ys), top: Math.max(...ys) };
  if (!wasSelected) {
    const look = { width: span.s1 - span.s0, height: world === undefined ? (span.v1 - span.v0) * run.heightAt(centerS) : world.top - world.bottom, shape };
    select(ctx, { groupKey: group, pieceKeys, shape }, look, params);
  }
  ctx.reportSelection({ id: surfaceRefFromNodeSet(opening.surfaceKey), point: run.resolveAt(centerS, centerV) });

  return {
    run,
    pieceKeys,
    pieceRefs: new Set(pieceKeys.map(surfaceRefFromNodeSet)),
    originalSpan: span,
    handle: world === undefined ? handleAt(run, span, at) : worldHandleAt(span, world, at.s, sample.point.y),
    isDoor: isDoorRect(span),
    shape,
    wasSelected,
    grabOffset: { s: at.s - centerS, v: at.v - centerV },
    hostSurfaceKey: hostKey!,
    ...held,
    ...(world === undefined ? {} : { world }),
  };
}

/** The handle of an opening in a stand under a press at `s` along its front and height `y`: its sides, its top -- its sill stands on the leaf. */
function worldHandleAt(span: RunRect, world: { readonly bottom: number; readonly top: number }, s: number, y: number): GrabHandle {
  return {
    s: Math.abs(s - span.s0) <= HANDLE_TOLERANCE ? "left" : Math.abs(s - span.s1) <= HANDLE_TOLERANCE ? "right" : undefined,
    v: Math.abs(y - world.top) <= HANDLE_TOLERANCE ? "top" : undefined,
  };
}

/** The stand `host` is, if one was raised for the opening in it. */
function standOf(ctx: ToolContext, host: ConstructionSurfaceKey): { readonly stand?: OpeningStand } {
  const stand = openingStands.find((candidate) => candidate.holds(ctx, host));
  return stand === undefined ? {} : { stand };
}

/**
 * A release after grabbing an opening in a stand: the stand is made again
 * round it. A body drag moves both over the face the stand rose from, by
 * how far the pointer went; an edge or a corner resizes the opening -- no
 * longer bounded by the stand, which grows with it; a click on the opening
 * already selected applies the sliders.
 */
/**
 * What a drag of an opening in a stand asks for -- its new size and how far
 * it moved in plan -- before the stand stops it where its face runs out.
 * `moved` false is a click: the sliders' size, when the opening was
 * already selected.
 */
function standEdit(active: Drag, start: ConstructionPosition, current: ConstructionPosition, moved: boolean, params: OpeningParams): { readonly look: StandLook; readonly shift: { readonly x: number; readonly z: number } } | undefined {
  const { run, originalSpan: span, handle } = active;
  const world = active.world ?? { bottom: 0, top: (span.v1 - span.v0) * run.heightAt((span.s0 + span.s1) / 2) };
  const middle = (span.s0 + span.s1) / 2;
  let [s0, s1, height] = [span.s0, span.s1, world.top - world.bottom];
  let shift = { x: 0, z: 0 };
  if (!moved) {
    [s0, s1, height] = [middle - params.width / 2, middle + params.width / 2, params.height];
  } else if (isBody(handle)) {
    shift = { x: current.x - start.x, z: current.z - start.z };
  } else {
    const at = run.project(current);
    if (at === undefined) return undefined;
    if (handle.s === "left") s0 = Math.min(at.s, span.s1 - MIN_OPENING_SIZE);
    if (handle.s === "right") s1 = Math.max(at.s, span.s0 + MIN_OPENING_SIZE);
    if (handle.v === "top") height = Math.max(current.y - world.bottom, MIN_OPENING_SIZE);
    // Its middle moved along the front: the stand moves with it.
    const step = 0.01;
    const a = run.resolveAt(middle, span.v0), b = run.resolveAt(middle + step, span.v0);
    const along = ((s0 + s1) / 2 - middle) / step;
    shift = { x: (b.x - a.x) * along, z: (b.z - a.z) * along };
  }
  return { look: { width: s1 - s0, height, shape: active.shape, isDoor: active.isDoor }, shift };
}

function refitStand(ctx: ToolContext, gesture: ReleasedGesture, active: Drag & { readonly stand: OpeningStand }, params: OpeningParams): void {
  if (!gesture.moved && !active.wasSelected) {
    ctx.reportFeedback({ tone: "info", message: SELECTED_MESSAGE });
    return;
  }
  const edit = standEdit(active, gesture.start.point, gesture.current.point, gesture.moved, params);
  if (edit === undefined) return;
  const { look, shift } = edit;
  const causeId = scopedToolId(ctx, "opening-edit", ctx.nextSequence());
  const result = active.stand.refit(ctx, causeId, active.pieceKeys, active.hostSurfaceKey, look, shift);
  clearSelection(ctx);
  reportCommit(ctx, causeId, result, gesture.moved && isBody(active.handle) ? "Abertura movida." : "Abertura redimensionada.");
}

/** The face under `sample`, when it raises a stand for an opening, and the kind of stand. */
function standUnder(ctx: ToolContext, sample: PointerSample): { readonly stand: OpeningStand; readonly face: ConstructionRegionTopology } | undefined {
  const picked = sample.surfaceRef;
  if (picked === undefined) return undefined;
  const face = ctx.runtime.getAllRegionTopologies().find((topology) => surfaceRefFromNodeSet(topology.surfaceKey) === picked);
  const stand = face === undefined ? undefined : openingStands.find((candidate) => candidate.raisesOn(face));
  return stand === undefined || face === undefined ? undefined : { stand, face };
}

function lookOfNew(params: OpeningParams): StandLook {
  return { width: params.width, height: params.height, shape: shapeOf(params), isDoor: params.openingKind === "door" };
}

/** A closed ring of world points as preview segments. */
function ringPreview(ring: readonly ConstructionPosition[], color: number): ReturnType<typeof segmentsPreview> {
  const positions: number[] = [];
  ring.forEach((from, index) => {
    const to = ring[(index + 1) % ring.length]!;
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  });
  return segmentsPreview(Float32Array.from(positions), color);
}

/** Where and how big the opening a press on a stand face makes -- drawn corner to corner by a drag, the sliders' size at a click -- stopped by the face. */
function standPlacement(stand: OpeningStand, face: ConstructionRegionTopology, from: ConstructionPosition, current: ConstructionPosition | undefined, params: OpeningParams): StandPlacement | undefined {
  const look = lookOfNew(params);
  return current === undefined ? stand.fitted(face, from, look) : stand.drawn(face, from, current, look.shape, look.isDoor);
}

/** A press on a face that raises a stand: the opening its preview showed, its stand raised round it. */
function raiseStand(ctx: ToolContext, pressed: Extract<Press, { kind: "stand" }>, gesture: ReleasedGesture, params: OpeningParams): void {
  const placed = standPlacement(pressed.stand, pressed.face, pressed.at, gesture.moved ? gesture.current.point : undefined, params);
  // Not even the smallest opening had room: the preview showed none, and none is made.
  if (placed === undefined) return;
  if (selected !== undefined) clearSelection(ctx);
  const causeId = scopedToolId(ctx, "opening", ctx.nextSequence());
  const result = pressed.stand.raise(ctx, causeId, pressed.face, placed);
  reportCommit(ctx, causeId, result, placed.look.isDoor ? "Porta aberta no telhado." : "Janela aberta no telhado.");
}

/** Where `active`'s opening would stand, before settling, if released at `at`. */
function rawRectFor(active: Drag, at: RunPoint): RunRect {
  const { originalSpan: span, handle, run } = active;
  if (!isBody(handle)) {
    const minV = MIN_OPENING_SIZE / run.heightAt((span.s0 + span.s1) / 2);
    let { s0, s1, v0, v1 } = span;
    if (handle.s === "left") s0 = Math.min(at.s, span.s1 - MIN_OPENING_SIZE);
    if (handle.s === "right") s1 = Math.max(at.s, span.s0 + MIN_OPENING_SIZE);
    if (handle.v === "top") v1 = Math.max(at.v, span.v0 + minV);
    // A door's floor sill never moves.
    if (handle.v === "bottom" && !active.isDoor) v0 = Math.min(at.v, span.v1 - minV);
    return { s0, s1, v0, v1 };
  }
  const ds = span.s1 - span.s0;
  const dv = span.v1 - span.v0;
  const centerS = at.s - active.grabOffset.s;
  const v0 = active.isDoor ? 0 : at.v - active.grabOffset.v - dv / 2;
  return { s0: centerS - ds / 2, s1: centerS + ds / 2, v0, v1: v0 + dv };
}

/** `active`'s opening resized to the sliders' width/height about its own center. */
function sliderRect(active: Drag, params: OpeningParams): RunRect {
  const { originalSpan: span, run } = active;
  const centerS = (span.s0 + span.s1) / 2;
  const dv = params.height / run.heightAt(centerS);
  const v0 = active.isDoor ? 0 : (span.v0 + span.v1) / 2 - dv / 2;
  return { s0: centerS - params.width / 2, s1: centerS + params.width / 2, v0, v1: v0 + dv };
}

function sameRect(a: RunRect, b: RunRect): boolean {
  const EPS = 1e-9;
  return Math.abs(a.s0 - b.s0) < EPS && Math.abs(a.s1 - b.s1) < EPS && Math.abs(a.v0 - b.v0) < EPS && Math.abs(a.v1 - b.v1) < EPS;
}

/** One closed ring per piece, resolved on its face so a slanted or curved face shows the deformed shape. */
function piecesPreview(pieces: readonly OpeningPiece[], color: number): ReturnType<typeof segmentsPreview> {
  const positions: number[] = [];
  for (const piece of pieces) {
    const ring = piece.panel.frame.resolve(piecePolyline(piece, PREVIEW_STEP));
    for (let index = 0; index < ring.length; index += 1) {
      const from = ring[index]!;
      const to = ring[(index + 1) % ring.length]!;
      positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
    }
  }
  return segmentsPreview(Float32Array.from(positions), color);
}

/** The ghost of `rect` outlined by `shape`, red where it would overlap another opening. */
function rectPreview(ctx: ToolContext, run: RunFrame, rect: RunRect, shape: OpeningShape, color: number, excluded?: ReadonlySet<string>): ReturnType<typeof segmentsPreview> | undefined {
  const pieces = run.pieces(rect, shape);
  if (pieces === undefined || pieces.length === 0) return undefined;
  return piecesPreview(pieces, overlapsOther(ctx, run, rect, excluded) ? OVERLAP_COLOR : color);
}

function dragPreview(gesture: ToolGesture, ctx: ToolContext, active: Drag): ReturnType<typeof segmentsPreview> | undefined {
  const at = active.run.project(gesture.current.point);
  if (at === undefined) return undefined;
  const rect = settleRect(active.run, rawRectFor(active, at), active.isDoor, isBody(active.handle));
  if (rect === undefined) return undefined;
  return rectPreview(ctx, active.run, rect, active.shape, OPENING_KIND_COLOR[active.isDoor ? "door" : "window"], active.pieceRefs);
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
const SELECTED_MESSAGE =
  "Abertura selecionada. Arraste o meio para mover, uma borda ou um canto para redimensionar; clique de novo para aplicar largura e altura; Delete apaga.";

/** Replaces `active`'s group with `raw` settled on the run; `keepWidth` settles by shifting rather than trimming. */
function commitEdit(ctx: ToolContext, active: Drag, raw: RunRect, keepWidth: boolean, success: string): void {
  const rect = sameRect(raw, active.originalSpan) ? active.originalSpan : settleRect(active.run, raw, active.isDoor, keepWidth);
  const pieces = rect === undefined ? undefined : active.run.pieces(rect, active.shape);
  if (rect === undefined || pieces === undefined || pieces.length === 0) {
    ctx.reportFeedback({ tone: "error", message: NO_FIT_MESSAGE });
    return;
  }
  if (sameRect(rect, active.originalSpan)) {
    ctx.reportFeedback({ tone: "info", message: SELECTED_MESSAGE });
    return;
  }
  if (overlapsOther(ctx, active.run, rect, active.pieceRefs)) {
    ctx.reportFeedback({ tone: "error", message: OVERLAP_MESSAGE });
    return;
  }
  const causeId = scopedToolId(ctx, "opening-edit", ctx.nextSequence());
  const result = commitOpeningGroup(ctx, causeId, active.pieceKeys, pieces, active.shape);
  clearSelection(ctx);
  reportCommit(ctx, causeId, result, success);
}

/** A release after grabbing an opening: a drag moves or resizes it; a plain click selects it, or applies the sliders when it already was. */
function releaseGrab(ctx: ToolContext, gesture: ReleasedGesture, active: Drag, params: OpeningParams): void {
  if (active.stand !== undefined) {
    refitStand(ctx, gesture, { ...active, stand: active.stand }, params);
    return;
  }
  if (!gesture.moved) {
    if (active.wasSelected) commitEdit(ctx, active, sliderRect(active, params), true, "Abertura redimensionada.");
    else ctx.reportFeedback({ tone: "info", message: SELECTED_MESSAGE });
    return;
  }
  const at = active.run.project(gesture.current.point);
  if (at === undefined) {
    ctx.reportFeedback({ tone: "error", message: NO_FIT_MESSAGE });
    return;
  }
  commitEdit(ctx, active, rawRectFor(active, at), isBody(active.handle), isBody(active.handle) ? "Abertura movida." : "Abertura redimensionada.");
}

/** The rect drawn from `anchor` to `at`, both read as opposite corners. */
function drawnRect(isDoor: boolean, anchor: CreateAnchor, at: RunPoint): RunRect | undefined {
  const s0 = Math.min(anchor.s, at.s), s1 = Math.max(anchor.s, at.s);
  const v0 = Math.min(anchor.v, at.v), v1 = Math.max(anchor.v, at.v);
  if (s1 - s0 < MIN_OPENING_SIZE) return undefined;
  if ((v1 - v0) * anchor.run.heightAt((s0 + s1) / 2) < MIN_OPENING_SIZE) return undefined;
  return settleRect(anchor.run, isDoor ? { s0, s1, v0: 0, v1: v1 - v0 } : { s0, s1, v0, v1 }, isDoor, false);
}

function createPreview(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext, anchor: CreateAnchor): ReturnType<typeof segmentsPreview> | undefined {
  const at = anchor.run.project(gesture.current.point, anchor.hostSurfaceKey);
  const rect = at === undefined ? undefined : drawnRect(params.openingKind === "door", anchor, at);
  return rect === undefined ? undefined : rectPreview(ctx, anchor.run, rect, shapeOf(params), OPENING_KIND_COLOR[params.openingKind]);
}

/** Places a new opening at `rect`; `params` are what a new opening takes. */
function placeNew(ctx: ToolContext, run: RunFrame, rect: RunRect | undefined, params: OpeningParams): void {
  const shape = shapeOf(params);
  const pieces = rect === undefined ? undefined : run.pieces(rect, shape);
  if (rect === undefined || pieces === undefined || pieces.length === 0) {
    ctx.reportFeedback({ tone: "error", message: NO_FIT_MESSAGE });
    return;
  }
  if (overlapsOther(ctx, run, rect)) {
    ctx.reportFeedback({ tone: "error", message: OVERLAP_MESSAGE });
    return;
  }
  if (selected !== undefined) clearSelection(ctx);
  const causeId = scopedToolId(ctx, "opening", ctx.nextSequence());
  const result = commitOpeningGroup(ctx, causeId, [], pieces, shape);
  reportCommit(ctx, causeId, result, params.openingKind === "door" ? "Porta aberta na parede." : "Janela aberta na parede.");
}

/** A release after pressing off any opening: a drag draws a new one; a plain click places one at the slider size. */
function releaseOnWall(ctx: ToolContext, gesture: ReleasedGesture, anchor: CreateAnchor | undefined, params: OpeningParams): void {
  if (!gesture.moved) {
    const placed = resolvePlacement(ctx, gesture.start, params);
    if (placed === undefined) {
      ctx.reportFeedback({ tone: "error", message: "Abertura: clique sobre uma parede reta ou curva, com espaco para a abertura caber nela." });
      return;
    }
    placeNew(ctx, placed.run, placed.rect, params);
    return;
  }
  const at = anchor?.run.project(gesture.current.point, anchor.hostSurfaceKey);
  if (anchor === undefined || at === undefined) return;
  placeNew(ctx, anchor.run, drawnRect(params.openingKind === "door", anchor, at), params);
}

export const openingTool: ConstructionTool<"opening"> = {
  id: "opening",
  defaultParams: () => DEFAULT_TOOL_PARAMS.opening,
  previewOnHover: true,
  // Placement is read in the run's own frame, never off raw world X/Z, so
  // the dispatcher's world-grid magnet must not round the pointer first.
  snapsToSurface: true,

  previewFor(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext) {
    // The same move a release will read, so the ghost is what the commit makes.
    const moved = gestureMoved(gesture.start, gesture.samples);
    if (press?.kind === "grab") {
      const { drag } = press;
      if (drag.stand === undefined) return dragPreview(gesture, ctx, drag);
      // Stopped by its face exactly as the release will stop it.
      if (!moved) return undefined;
      const edit = standEdit(drag, gesture.start.point, gesture.current.point, true, params);
      const ring = edit === undefined ? undefined : drag.stand.refitOutline(ctx, drag.hostSurfaceKey, edit.look, edit.shift);
      return ring === undefined ? undefined : ringPreview(ring, OPENING_KIND_COLOR[drag.isDoor ? "door" : "window"]);
    }
    const fresh = forNew(params);
    // Over a face that raises a stand: the opening's outline, upright where it would stand, stopped by the face.
    const onStand = press?.kind === "stand" ? press : standUnder(ctx, gesture.current);
    if (onStand !== undefined) {
      const from = press?.kind === "stand" ? press.at : gesture.current.point;
      const placed = standPlacement(onStand.stand, onStand.face, from, press?.kind === "stand" && moved ? gesture.current.point : undefined, fresh);
      const ring = placed === undefined ? undefined : onStand.stand.outline(onStand.face, placed);
      return ring === undefined ? undefined : ringPreview(ring, OPENING_KIND_COLOR[fresh.openingKind]);
    }
    if (press?.kind === "wall" && press.anchor !== undefined) return createPreview(gesture, fresh, ctx, press.anchor);
    const placed = resolvePlacement(ctx, gesture.current, fresh);
    if (placed?.rect === undefined) return undefined;
    return rectPreview(ctx, placed.run, placed.rect, shapeOf(fresh), OPENING_KIND_COLOR[fresh.openingKind]);
  },

  onPointerDown(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
    press = undefined;
    const opening = openingUnder(ctx, sample);
    if (opening !== undefined) {
      const drag = beginGrab(ctx, opening, sample, params);
      if (drag !== undefined) press = { kind: "grab", drag };
      else ctx.reportFeedback({ tone: "error", message: "Nao foi possivel identificar a parede desta abertura." });
      return;
    }
    // A face an opening cannot lie in raises a stand for it instead.
    const onStand = standUnder(ctx, sample);
    if (onStand !== undefined) {
      press = { kind: "stand", ...onStand, at: sample.point };
      return;
    }
    const hostSurfaceKey = wallUnder(ctx, sample);
    const placed = hostSurfaceKey === undefined ? undefined : runPointAt(ctx, hostSurfaceKey, sample.point);
    press = { kind: "wall", anchor: hostSurfaceKey === undefined || placed === undefined ? undefined : { run: placed.run, hostSurfaceKey, ...placed.at } };
  },

  onPointerUp(ctx: ToolContext, gesture: ReleasedGesture, params: OpeningParams): void {
    const released = press;
    press = undefined;
    if (released?.kind === "grab") releaseGrab(ctx, gesture, released.drag, params);
    else if (released?.kind === "wall") releaseOnWall(ctx, gesture, released.anchor, forNew(params));
    else if (released?.kind === "stand") raiseStand(ctx, released, gesture, forNew(params));
  },

  onParamsChange(ctx: ToolContext, next: OpeningParams): void {
    if (selected === undefined || sameShape(shapeOf(next), selected.shape)) return;
    reshapeSelected(ctx, selected, shapeOf(next));
  },

  onDeleteKey(ctx: ToolContext): void {
    if (selected === undefined) return;
    const causeId = scopedToolId(ctx, "opening-edit-delete", ctx.nextSequence());
    // An opening in a stand takes its stand with it.
    const refs = new Set(selected.pieceKeys.map(surfaceRefFromNodeSet));
    const piece = ctx.runtime.getAllRegionTopologies().find((topology) => refs.has(surfaceRefFromNodeSet(topology.surfaceKey)));
    const host = piece === undefined ? undefined : primaryHostOf(piece);
    const stand = host === undefined ? undefined : standOf(ctx, host).stand;
    const result = stand !== undefined && host !== undefined ? stand.drop(ctx, causeId, selected.pieceKeys, host) : commitOpeningGroup(ctx, causeId, selected.pieceKeys, []);
    clearSelection(ctx);
    reportCommit(ctx, causeId, result, stand !== undefined ? "Abertura removida com a sua lucarna." : "Abertura removida; parede restaurada.");
  },

  onCancel(ctx: ToolContext): void {
    press = undefined;
    clearSelection(ctx);
  },
};

/** Replaces the selected group with the same rectangle outlined by `shape`; it stays selected. */
function reshapeSelected(ctx: ToolContext, current: Selected, shape: OpeningShape): void {
  const refs = new Set(current.pieceKeys.map(surfaceRefFromNodeSet));
  const pieces = ctx.runtime.getAllRegionTopologies().filter((topology) => refs.has(surfaceRefFromNodeSet(topology.surfaceKey)));
  const hostKey = pieces.length === current.pieceKeys.length && pieces.length > 0 ? primaryHostOf(pieces[0]!) : undefined;
  const run = hostKey === undefined ? undefined : runFrame(ctx.runtime, hostKey);
  const span = run === undefined ? undefined : groupRunSpan(run, pieces);
  // In a stand, the stand is made again round the new outline, the opening keeping its size.
  const stand = hostKey === undefined ? undefined : standOf(ctx, hostKey).stand;
  if (stand !== undefined && span !== undefined) {
    const ys = pieces.flatMap((piece) => piece.nodes.map((node) => node.position.y));
    const look = { width: span.s1 - span.s0, height: Math.max(...ys) - Math.min(...ys), shape, isDoor: isDoorRect(span) };
    const causeId = scopedToolId(ctx, "opening-edit-shape", ctx.nextSequence());
    const result = stand.refit(ctx, causeId, current.pieceKeys, hostKey!, look, { x: 0, z: 0 });
    if (result.created !== undefined) selected = { groupKey: result.created.group, pieceKeys: result.created.surfaceKeys, shape };
    reportCommit(ctx, causeId, result, "Formato da abertura alterado.");
    return;
  }
  const split = run === undefined || span === undefined ? undefined : run.pieces(span, shape);
  if (split === undefined || split.length === 0) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: nao foi possivel mudar o formato desta abertura." });
    return;
  }
  const causeId = scopedToolId(ctx, "opening-edit-shape", ctx.nextSequence());
  const result = commitOpeningGroup(ctx, causeId, current.pieceKeys, split, shape);
  if (result.created !== undefined) selected = { groupKey: result.created.group, pieceKeys: result.created.surfaceKeys, shape };
  reportCommit(ctx, causeId, result, "Formato da abertura alterado.");
}

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

/** The run under the pointer with a slider-sized opening centered on the click, its bottom at the clicked height -- `rect` undefined when it will not fit. */
function resolvePlacement(
  ctx: ToolContext,
  sample: PointerSample,
  params: OpeningParams,
): { readonly run: RunFrame; readonly rect: RunRect | undefined } | undefined {
  const hostSurfaceKey = wallUnder(ctx, sample);
  const placed = hostSurfaceKey === undefined ? undefined : runPointAt(ctx, hostSurfaceKey, sample.point);
  if (placed === undefined) return undefined;
  const { run, at } = placed;
  const height = run.heightAt(Math.max(run.start, Math.min(run.end, at.s)));
  if (!(height > 0)) return { run, rect: undefined };
  const dv = params.height / height;
  const isDoor = params.openingKind === "door";
  const v0 = isDoor ? 0 : snapped(at.v * height) / height;
  return { run, rect: settleRect(run, { s0: at.s - params.width / 2, s1: at.s + params.width / 2, v0, v1: v0 + dv }, isDoor) };
}
