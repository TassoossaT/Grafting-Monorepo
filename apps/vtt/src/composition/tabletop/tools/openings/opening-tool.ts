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
import { DEFAULT_TOOL_PARAMS, hasTrait, openingStructureType, panelHeightWidgetPick, panelRailOf, type PanelRail } from "../../../../features/edit-construction/index.ts";

import { scopedToolId, type ConstructionTool, type PointerSample, type ToolContext, type ToolGesture } from "../core/tool-context.ts";
import { segmentsPreview } from "../shapes/preview-shapes.ts";
import { findWallSurfaceAt } from "../walls/wall-shared.ts";
import {
  commitOpeningReplacement,
  deriveOpeningParams,
  hostWallOf,
  MARGIN,
  openingOverlapsSibling,
  openingSpan,
  rimCorners,
  type OpeningRemoval,
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
 * window and drag to move it live; press anywhere else on a wall and drag
 * to draw a brand-new one, its own two dragged corners deciding its size
 * (`dragRect`) the same way a wall run or a platform's rectangle is drawn --
 * not a fixed slider size stamped wherever you clicked. Release commits --
 * unless nothing actually moved, which leaves the opening merely selected
 * (Delete/Backspace removes it, restoring the wall; adjust the
 * width/height/sill sliders and drag it again to resize it deliberately,
 * see `beginGrab`). A plain click with no drag at all still places one
 * opening at the tool's own slider size, centered on the point clicked --
 * the quick path `onClick` keeps for when drawing a precise size is more
 * trouble than it is worth. Not click-select-then-click-elsewhere: that
 * model left no way to start a second, independent opening while one was
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

/**
 * Which part of an existing opening a press landed on, as the side of each
 * axis it grabbed. Neither side = the body, which translates the whole rim.
 * One side = an edge, which stretches just that edge. Both = a corner,
 * which stretches the two edges meeting there. The corners are the rim's
 * own nodes, the dots the runtime draws on every node, so the handle you
 * can see is the one that resizes.
 */
interface GrabHandle {
  readonly travel?: "left" | "right";
  readonly y?: "top" | "bottom";
}

/** How close (in rail travel/height units) a press has to land to an opening's own rim edge to grab *that edge* instead of the whole body -- generous enough to find with an ordinary click, tight enough that grabbing well inside the pane (however that pane's own sill happens to line up) always reads as "move", never "resize". */
const HANDLE_TOLERANCE = 0.12;

type Span = { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number };

/** Which edges `travel`/`y` (already known to be on the opening) sits close to -- both at once near a corner. */
function handleAt(span: Span, travel: number, y: number): GrabHandle {
  const side =
    Math.abs(travel - span.from) <= HANDLE_TOLERANCE ? "left" : Math.abs(travel - span.to) <= HANDLE_TOLERANCE ? "right" : undefined;
  const level =
    Math.abs(y - span.top) <= HANDLE_TOLERANCE ? "top" : Math.abs(y - span.bottom) <= HANDLE_TOLERANCE ? "bottom" : undefined;
  return { travel: side, y: level };
}

/** The exact corner a press on one of the rim's own node dots means -- the nearer side on each axis, never the body, whatever the pick's own offset off the dot's center. */
function cornerAt(span: Span, travel: number, y: number): GrabHandle {
  return {
    travel: Math.abs(travel - span.from) <= Math.abs(travel - span.to) ? "left" : "right",
    y: Math.abs(y - span.bottom) <= Math.abs(y - span.top) ? "bottom" : "top",
  };
}

/**
 * The one side a press on an edge widget means -- the rim edge `edgeId`
 * names, read by which of the rim's four sides its own midpoint sits on.
 * The widget is the same edge dot every partition edge gets (the hole a
 * window cuts shares its edges with the window's rim), so it moves that
 * edge here just as it does from a wall tool.
 */
function edgeWidgetHandle(rail: PanelRail, opening: ConstructionRegionTopology, span: Span, edgeId: string): GrabHandle | undefined {
  const edge = opening.outerLoops.flat().find((use) => use.edgeId === edgeId);
  if (edge === undefined) return undefined;
  const start = opening.nodes.find((node) => node.id === edge.startNodeId)?.position;
  const end = opening.nodes.find((node) => node.id === edge.endNodeId)?.position;
  if (start === undefined || end === undefined) return undefined;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, z: (start.z + end.z) / 2 };
  const travel = rail.travelTo(mid);
  const sides: readonly [number, GrabHandle][] = [
    [Math.abs(travel - span.from), { travel: "left" }],
    [Math.abs(travel - span.to), { travel: "right" }],
    [Math.abs(mid.y - span.bottom), { y: "bottom" }],
    [Math.abs(mid.y - span.top), { y: "top" }],
  ];
  return sides.reduce((best, side) => (side[0] < best[0] ? side : best))[1];
}

function widgetEdgeOf(opening: ConstructionRegionTopology, nodeId: string | undefined): string | undefined {
  const widget = nodeId === undefined ? undefined : panelHeightWidgetPick(nodeId);
  if (widget === undefined) return undefined;
  return opening.outerLoops.some((loop) => loop.some((use) => use.edgeId === widget.edgeId)) ? widget.edgeId : undefined;
}

function isBody(handle: GrabHandle): boolean {
  return handle.travel === undefined && handle.y === undefined;
}

interface Drag {
  readonly openingSurfaceKey: ConstructionSurfaceKey;
  readonly wallSurfaceKey: ConstructionSurfaceKey;
  readonly holeIndex: number;
  readonly originalSpan: { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number };
  /** Which part was grabbed -- see `GrabHandle`. */
  readonly handle: GrabHandle;
  /** The size (and door/window-ness) a *body* drag moves -- almost always read off the opening's own rim, never the tool's live width/height sliders, so grabbing and nudging an opening can never silently resize it to whatever the sliders last held. See `beginGrab`. An edge drag ignores `width`/`height` entirely: it stretches `originalSpan` directly. */
  readonly params: OpeningParams;
  /** Travel/height offset from the grab point to the opening's own center, so a *body* drag does not jump to re-center the opening on the cursor the instant it starts -- it keeps whatever offset you actually grabbed it at. Irrelevant to an edge drag, which follows the cursor exactly. */
  readonly grabOffset: { readonly travel: number; readonly y: number };
}

/** The opening currently being press-dragged, if any -- live for exactly one gesture. */
let drag: Drag | undefined;
/** Whether `onPointerDown` grabbed an opening this gesture, so the release's native `click` does not also run the create path. */
let grabbedThisGesture = false;

/** The wall and rail a brand-new opening is being drawn on, anchored at the press point -- live for exactly one create gesture. */
interface CreateAnchor {
  readonly wallSurfaceKey: ConstructionSurfaceKey;
  readonly rail: PanelRail;
  readonly travel: number;
  readonly y: number;
}
let creating: CreateAnchor | undefined;
/** Whether `onPointerUp` already placed a new opening from a real drag this gesture, so the release's native `click` does not also run the fixed-size create path. */
let createdThisGesture = false;

/** How far (in world units) a press has to travel before it counts as "drew a size" rather than "just clicked" -- the same order of magnitude as the dispatcher's own click/drag distinction (`use-construction-pointer.ts`'s `suppressClickRef`), so the two agree about which gestures are which. */
const CREATE_DRAG_THRESHOLD = 0.05;

function clearSelection(ctx: ToolContext): void {
  selected = undefined;
  ctx.reportSelection(undefined);
}

/** Same order of magnitude as walls' own `WALL_PICK_TOLERANCE` (`wall-shared.ts`) -- how far off an opening's own rim a click may land and still count as "on it". */
const OPENING_PICK_TOLERANCE = 0.2;

/**
 * The closest opening whose own rim genuinely contains `point`, read off
 * its host wall's rail -- the fallback for when the renderer's own pick
 * missed the opening's face outright (a thin, `physical: false` panel is
 * an easy miss at a grazing camera angle, the same reason
 * `wallUnder`/`findWallSurfaceAt` below exists as a fallback for walls).
 * Bounded by {@link OPENING_PICK_TOLERANCE} so a point nowhere near any
 * wall cannot spuriously match one just because its rail's nearest
 * projection happens to fall within some opening's travel/height range.
 */
function openingNear(ctx: ToolContext, point: ConstructionPosition): ConstructionRegionTopology | undefined {
  let best: { readonly topology: ConstructionRegionTopology; readonly distanceSq: number } | undefined;
  for (const topology of ctx.runtime.getAllRegionTopologies()) {
    if (topology.surfaceType !== openingStructureType.surfaceType) continue;
    const host = hostWallOf(ctx, topology);
    if (host === undefined) continue;
    const rail = panelRailOf(ctx.runtime, host.wall);
    if (rail === undefined) continue;
    const span = openingSpan(rail, topology);
    if (span === undefined) continue;
    const travel = rail.travelTo(point);
    if (travel < span.from || travel > span.to || point.y < span.bottom || point.y > span.top) continue;
    const projected = rail.positionAt(travel, point.y);
    const distanceSq = (point.x - projected.x) ** 2 + (point.z - projected.z) ** 2;
    if (distanceSq > OPENING_PICK_TOLERANCE ** 2) continue;
    if (best === undefined || distanceSq < best.distanceSq) best = { topology, distanceSq };
  }
  return best?.topology;
}

function isRimNode(opening: ConstructionRegionTopology, nodeId: string | undefined): boolean {
  return nodeId !== undefined && opening.nodes.some((node) => node.id === nodeId);
}

/** The opening region under the pointer, if any -- pick-by-`surfaceRef` first (the same read `wallUnder` uses below), then `openingNear`'s geometric fallback, scoped to the opening's own surface type so clicking a placed window never gets read as clicking the wall behind it. */
function openingUnder(ctx: ToolContext, sample: PointerSample): ConstructionRegionTopology | undefined {
  // A press on one of a rim's own dots (a corner node, or an edge's widget):
  // the dot sits on or just off the rim, so the pick point can land outside
  // the rim `openingNear` checks.
  if (sample.nodeId !== undefined) {
    const owner = ctx.runtime
      .getAllRegionTopologies()
      .find(
        (topology) =>
          topology.surfaceType === openingStructureType.surfaceType &&
          (isRimNode(topology, sample.nodeId) || widgetEdgeOf(topology, sample.nodeId) !== undefined),
      );
    if (owner !== undefined) return owner;
  }
  const picked = sample.surfaceRef;
  if (picked !== undefined) {
    const hit = ctx.runtime
      .getAllRegionTopologies()
      .find((topology) => topology.surfaceType === openingStructureType.surfaceType && surfaceRefFromNodeSet(topology.surfaceKey) === picked);
    if (hit !== undefined) return hit;
  }
  return openingNear(ctx, sample.point);
}

/**
 * The sill a window standing at `y` on `rail` would have -- clamped to
 * whatever range still leaves room for `params.height` between the floor
 * and the lintel, so a click too low or too high settles at the nearest
 * spot that still fits rather than refusing outright. A door's sill is
 * never read from the pointer: it always sits on the floor, the same
 * invariant `rimCorners` itself already enforces.
 *
 * Height along the wall was, until this, entirely a `params.sill` slider
 * value no click or drag ever touched -- every window landed at whatever
 * height the slider last held, no matter where on the wall you clicked.
 * This is what lets the vertical spot you actually clicked or dragged to
 * decide it instead, the same way the horizontal spot always has.
 */
function sillAt(rail: PanelRail, y: number, params: OpeningParams): number {
  if (params.openingKind === "door") return 0;
  const min = MARGIN;
  const max = Math.max(min, rail.topY - rail.baseY - MARGIN - params.height);
  const clamped = Math.max(min, Math.min(y - rail.baseY, max));
  // Snapping can round a value that was sitting exactly on `max` up past it
  // -- re-clamp afterwards so a fit that only just fits is never pushed into
  // one `rimCorners` refuses outright.
  return Math.min(Math.max(snapped(clamped), min), max);
}

/**
 * Rounds to a small fixed increment.
 *
 * The hover preview redraws on every raw pointer-move event, unthrottled
 * (`use-construction-pointer.ts`'s hover branch), and `sillAt` now follows
 * the raw pick's own Y continuously where it used to be a fixed param --
 * the tiniest sub-pixel difference in the picked world position, from
 * nothing more than a grazing camera angle, used to regenerate a whole new
 * rim a hair higher or lower than the last. Close enough that it only read
 * as smooth, continuous motion while the picker's own precision held up
 * perfectly; any noise in that made the ghost hop between two
 * barely-different heights every frame, which reads as flicker rather than
 * motion. Snapping absorbs exactly that noise without being coarse enough
 * to feel like a grid magnet.
 */
function snapped(value: number): number {
  const step = 0.02;
  return Math.round(value / step) * step;
}

/** `params` with its sill replaced by whatever `sillAt` reads off `point` on `rail` -- what every `rimCorners` call below actually places, so a click or drag's height is never silently discarded in favor of the slider's last value. */
function paramsAt(rail: PanelRail, point: ConstructionPosition, params: OpeningParams): OpeningParams {
  return { ...params, sill: sillAt(rail, point.y, params) };
}

/** How much bare wall between two same-kind openings still reads as "meant to be one continuous opening" rather than two separate ones -- generous enough to catch a click placed a little short of flush, twice `rimCorners`' own `MARGIN`. */
const MERGE_GAP = MARGIN * 2;

/** The smallest width or height a drawn or dragged opening is allowed to settle at -- small enough to feel unrestrictive, large enough that an almost-stationary drag never produces a sliver no one meant to create. */
const MIN_OPENING_SIZE = 0.3;

/**
 * `[from, to] x [bottom, top]`, repositioned (never resized) to fit within
 * `rail`'s own travel and height range -- the shared clamp every rect this
 * tool ever places or moves settles through, so "doesn't fit" always means
 * the same thing. A door's `bottom` is always the rail's own floor, same
 * invariant `rimCorners` enforces for a plain click. `undefined` when the
 * rect is simply too big for what's left of the rail once `MARGIN` is kept
 * on every side -- not shrunk to fit, since a shrunk opening is never what
 * either a drag or a draw actually asked for.
 */
function clampRect(
  rail: PanelRail,
  isDoor: boolean,
  from: number,
  to: number,
  bottom: number,
  top: number,
): { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number } | undefined {
  const width = to - from;
  const clampedFrom = Math.max(MARGIN, Math.min(from, rail.length - MARGIN - width));
  const clampedTo = clampedFrom + width;
  if (clampedTo > rail.length - MARGIN) return undefined;

  const height = top - bottom;
  const clampedBottom = isDoor ? rail.baseY : Math.max(rail.baseY + MARGIN, Math.min(bottom, rail.topY - MARGIN - height));
  const clampedTop = clampedBottom + height;
  if (clampedTop > rail.topY - MARGIN) return undefined;

  return { from: clampedFrom, to: clampedTo, bottom: clampedBottom, top: clampedTop };
}

/**
 * The rect a brand-new opening being press-drawn from `anchor` to `point`
 * resolves to -- unlike a plain click (which centers a fixed slider size on
 * one point), both ends of the drag are read directly as the rim's own
 * corners, so the opening grows and shrinks with the drag the same way
 * every other construction tool's drawn shape does.
 */
function dragRect(
  rail: PanelRail,
  isDoor: boolean,
  anchor: { readonly travel: number; readonly y: number },
  point: { readonly travel: number; readonly y: number },
): { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number } | undefined {
  const from = Math.min(anchor.travel, point.travel);
  const to = Math.max(anchor.travel, point.travel);
  const bottom = Math.min(anchor.y, point.y);
  const top = Math.max(anchor.y, point.y);
  if (to - from < MIN_OPENING_SIZE || top - bottom < MIN_OPENING_SIZE) return undefined;
  return clampRect(rail, isDoor, from, to, bottom, top);
}

/** One rect's own four corners, as a closed-ring segment preview. */
function ringPreview(rail: PanelRail, rect: { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number }, color: number): ReturnType<typeof segmentsPreview> {
  const corners = [
    rail.positionAt(rect.from, rect.bottom),
    rail.positionAt(rect.to, rect.bottom),
    rail.positionAt(rect.to, rect.top),
    rail.positionAt(rect.from, rect.top),
  ];
  const ring = [...corners, corners[0]!];
  const positions: number[] = [];
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const from = ring[index]!;
    const to = ring[index + 1]!;
    positions.push(from.x, from.y, from.z, to.x, to.y, to.z);
  }
  return segmentsPreview(Float32Array.from(positions), color);
}

/** The opening standing in `wall`'s hole at `holeIndex`, found the same way `hostWallOf` finds a wall from an opening -- by the edge the hole and the face share. */
function openingForHole(ctx: ToolContext, wall: ConstructionRegionTopology, holeIndex: number): ConstructionRegionTopology | undefined {
  const loop = wall.holes[holeIndex];
  const edgeId = loop?.[0]?.edgeId;
  if (edgeId === undefined) return undefined;
  return ctx.runtime
    .getAllRegionTopologies()
    .find((topology) => topology.surfaceType === openingStructureType.surfaceType && topology.outerLoops[0]?.some((use) => use.edgeId === edgeId));
}

/**
 * Grows `[from, to] x [bottom, top]` to absorb every same-kind opening
 * already on `wall` that sits close enough alongside it -- placing a
 * second window right beside a first one reads as "make it one wider
 * window", not "stack a second, separate one with a sliver of wall
 * between them". Runs to a fixed point so three windows placed in a row,
 * one at a time, end up as one continuous opening rather than a chain of
 * pairwise merges. A door never absorbs a window or vice versa: a
 * sibling's own kind is read back off its rim the same way
 * `deriveOpeningParams` always has.
 */
function mergeWithNeighbors(
  ctx: ToolContext,
  wall: ConstructionRegionTopology,
  rail: PanelRail,
  kind: OpeningParams["openingKind"],
  initial: { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number },
  excludeHoleIndex?: number,
): { readonly from: number; readonly to: number; readonly bottom: number; readonly top: number; readonly removals: readonly OpeningRemoval[] } {
  let { from, to, bottom, top } = initial;
  const absorbed = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    wall.holes.forEach((loop, index) => {
      if (index === excludeHoleIndex || absorbed.has(index) || loop.length === 0) return;
      const opening = openingForHole(ctx, wall, index);
      if (opening === undefined) return;
      const derived = deriveOpeningParams(rail, opening);
      if (derived === undefined || derived.openingKind !== kind) return;
      const span = openingSpan(rail, opening);
      if (span === undefined) return;
      const heightOverlaps = bottom < span.top && top > span.bottom;
      const closeEnough = from - span.to <= MERGE_GAP && span.from - to <= MERGE_GAP;
      if (!heightOverlaps || !closeEnough) return;
      from = Math.min(from, span.from);
      to = Math.max(to, span.to);
      bottom = Math.min(bottom, span.bottom);
      top = Math.max(top, span.top);
      absorbed.add(index);
      changed = true;
    });
  }
  const removals = [...absorbed].map((holeIndex) => {
    const opening = openingForHole(ctx, wall, holeIndex)!;
    return { faceSurfaceKey: opening.surfaceKey, wallSurfaceKey: wall.surfaceKey, holeIndex };
  });
  return { from, to, bottom, top, removals };
}

/**
 * Starts a drag on `opening`, if it can be read as a rail-mounted rim --
 * `false` when its host wall cannot be found, leaving the gesture to fall
 * through to placement.
 *
 * `liveParams` (the tool's own width/height sliders) is deliberately
 * ignored in favor of the opening's own current size, read back off its
 * rim via `deriveOpeningParams` -- a plain grab-and-nudge must never
 * silently resize the opening to whatever the sliders happen to hold,
 * which is what made every drag double as an accidental resize before this.
 * The one exception: grabbing an opening that is *already* this tool's
 * selection (a second press, after the first press-release just selected
 * it) reads as "I changed the sliders on purpose, now apply them" -- the
 * "arraste de novo" workflow the width/height/sill sliders exist for.
 */
function beginGrab(ctx: ToolContext, opening: ConstructionRegionTopology, sample: PointerSample, liveParams: OpeningParams): boolean {
  const point = sample.point;
  const host = hostWallOf(ctx, opening);
  if (host === undefined) return false;
  const rail = panelRailOf(ctx.runtime, host.wall);
  if (rail === undefined) return false;
  const span = openingSpan(rail, opening);
  if (span === undefined) return false;
  const derived = deriveOpeningParams(rail, opening);
  if (derived === undefined) return false;

  // `ConstructionSurfaceKey` is an array of node ids, a fresh one every time
  // the topology is re-read off the runtime -- `===` would never match even
  // for the exact same face, so identity has to go through the same string
  // ref `surfaceRefFromNodeSet` already gives every other comparison here.
  const alreadySelected = selected !== undefined && surfaceRefFromNodeSet(selected.openingSurfaceKey) === surfaceRefFromNodeSet(opening.surfaceKey);
  const params = alreadySelected ? { ...derived, width: liveParams.width, height: liveParams.height } : derived;

  const travel = rail.travelTo(point);
  const widgetEdge = widgetEdgeOf(opening, sample.nodeId);
  const handle =
    (widgetEdge !== undefined ? edgeWidgetHandle(rail, opening, span, widgetEdge) : undefined) ??
    (isRimNode(opening, sample.nodeId) ? cornerAt(span, travel, point.y) : handleAt(span, travel, point.y));
  const centerTravel = (span.from + span.to) / 2;
  const centerY = (span.bottom + span.top) / 2;
  selected = { openingSurfaceKey: opening.surfaceKey, wallSurfaceKey: host.wall.surfaceKey, holeIndex: host.holeIndex };
  drag = {
    openingSurfaceKey: opening.surfaceKey,
    wallSurfaceKey: host.wall.surfaceKey,
    holeIndex: host.holeIndex,
    originalSpan: span,
    handle,
    params,
    grabOffset: { travel: travel - centerTravel, y: point.y - centerY },
  };
  ctx.reportSelection({ id: surfaceRefFromNodeSet(opening.surfaceKey), point: rail.positionAt(centerTravel, centerY) });
  return true;
}

/**
 * Where `active`'s opening would stand if released at `point`.
 *
 * A body drag is a pure translate, `active.params`' own width/height
 * carried along unchanged (see `beginGrab`) -- a door never moves
 * vertically even then, since its sill is always the floor. An edge drag
 * ignores `params.width`/`height` entirely and instead moves just that one
 * edge of `originalSpan`, the other three staying exactly where they were
 * -- the actual resize a real handle would do. A door's `bottom` edge is
 * not draggable (there is no sill to move), the same floor-pin every other
 * door path already enforces.
 */
function rectFor(rail: PanelRail, active: Drag, point: ConstructionPosition): Span | undefined {
  const { originalSpan: span, handle } = active;
  const isDoor = active.params.openingKind === "door";
  const travel = rail.travelTo(point);

  if (!isBody(handle)) {
    let { from, to, bottom, top } = span;
    if (handle.travel === "left") from = Math.min(travel, span.to - MIN_OPENING_SIZE);
    if (handle.travel === "right") to = Math.max(travel, span.from + MIN_OPENING_SIZE);
    if (handle.y === "top") top = Math.max(point.y, span.bottom + MIN_OPENING_SIZE);
    // A door's floor sill never moves -- its bottom corners stretch sideways only.
    if (handle.y === "bottom" && !isDoor) bottom = Math.min(point.y, span.top - MIN_OPENING_SIZE);
    return clampRect(rail, isDoor, from, to, bottom, top);
  }

  const { width, height } = active.params;
  const centerTravel = travel - active.grabOffset.travel;
  const from = centerTravel - width / 2;
  const to = centerTravel + width / 2;
  const bottom = isDoor ? rail.baseY : point.y - active.grabOffset.y - height / 2;
  const top = bottom + height;
  return clampRect(rail, isDoor, from, to, bottom, top);
}

/** The live move preview for the opening being dragged, at the pointer's current spot on its host wall. */
function dragPreview(gesture: ToolGesture, ctx: ToolContext, active: Drag): ReturnType<typeof segmentsPreview> | undefined {
  const wall = ctx.runtime.getRegionTopology(active.wallSurfaceKey);
  if (wall === undefined) return undefined;
  const rail = panelRailOf(ctx.runtime, wall);
  if (rail === undefined) return undefined;
  const rect = rectFor(rail, active, gesture.current.point);
  if (rect === undefined) return undefined;
  const overlaps = openingOverlapsSibling(rail, wall, rect.from, rect.to, rect.bottom, rect.top, active.holeIndex);
  return ringPreview(rail, rect, overlaps ? OVERLAP_COLOR : OPENING_COLOR[active.params.openingKind]);
}

/** Commits the drag's move or resize to wherever it was released -- a no-op (kept selected, not committed) when the rim never actually changed, so a plain click just selects. */
function commitDrag(ctx: ToolContext, gesture: ToolGesture, active: Drag): void {
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
  const rect = rectFor(rail, active, gesture.current.point);
  if (rect === undefined) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: nao cabe aqui." });
    return;
  }

  const EPS = 1e-6;
  const unchanged =
    Math.abs(rect.from - active.originalSpan.from) < EPS &&
    Math.abs(rect.to - active.originalSpan.to) < EPS &&
    Math.abs(rect.bottom - active.originalSpan.bottom) < EPS &&
    Math.abs(rect.top - active.originalSpan.top) < EPS;
  if (unchanged) {
    ctx.reportFeedback({ tone: "info", message: "Abertura selecionada. Arraste o meio para mover, uma borda ou um canto para redimensionar; Delete apaga." });
    return;
  }

  const merged = mergeWithNeighbors(ctx, wall, rail, active.params.openingKind, rect, active.holeIndex);
  if (openingOverlapsSibling(rail, wall, merged.from, merged.to, merged.bottom, merged.top, [active.holeIndex, ...merged.removals.map((r) => r.holeIndex)])) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: sobreporia outra abertura ja existente nesta parede." });
    return;
  }

  const causeId = scopedToolId(ctx, "opening-edit", ctx.nextSequence());
  const { recorded, error } = commitOpeningReplacement(
    ctx,
    causeId,
    [{ faceSurfaceKey: active.openingSurfaceKey, wallSurfaceKey: active.wallSurfaceKey, holeIndex: active.holeIndex }, ...merged.removals],
    { wallSurfaceKey: wall.surfaceKey, rail, from: merged.from, to: merged.to, bottom: merged.bottom, top: merged.top, openingKind: active.params.openingKind },
  );
  clearSelection(ctx);
  if (error !== undefined) {
    ctx.reportFeedback({ tone: "error", message: `Abertura: ${error}` });
    return;
  }
  if (recorded) ctx.history?.record({ kind: "transaction", transactionId: causeId });
  ctx.reportFeedback({ tone: "success", message: isBody(active.handle) ? "Abertura movida." : "Abertura redimensionada." });
}

/** The live create-drag preview for a brand-new opening, from `anchor` to the pointer's current spot on the same wall. */
function createPreview(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext, anchor: CreateAnchor): ReturnType<typeof segmentsPreview> | undefined {
  const wall = ctx.runtime.getRegionTopology(anchor.wallSurfaceKey);
  if (wall === undefined) return undefined;
  const point = { travel: anchor.rail.travelTo(gesture.current.point), y: gesture.current.point.y };
  const rect = dragRect(anchor.rail, params.openingKind === "door", anchor, point);
  if (rect === undefined) return undefined;
  const overlaps = openingOverlapsSibling(anchor.rail, wall, rect.from, rect.to, rect.bottom, rect.top);
  return ringPreview(anchor.rail, rect, overlaps ? OVERLAP_COLOR : OPENING_COLOR[params.openingKind]);
}

/** Commits a brand-new opening drawn from `anchor` to wherever the drag was released. */
function commitCreateDrag(ctx: ToolContext, gesture: ToolGesture, params: OpeningParams, anchor: CreateAnchor): void {
  const wall = ctx.runtime.getRegionTopology(anchor.wallSurfaceKey);
  if (wall === undefined) return;
  const point = { travel: anchor.rail.travelTo(gesture.current.point), y: gesture.current.point.y };
  const rect = dragRect(anchor.rail, params.openingKind === "door", anchor, point);
  if (rect === undefined) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: nao cabe aqui." });
    return;
  }
  const merged = mergeWithNeighbors(ctx, wall, anchor.rail, params.openingKind, rect);
  if (openingOverlapsSibling(anchor.rail, wall, merged.from, merged.to, merged.bottom, merged.top, merged.removals.map((r) => r.holeIndex))) {
    ctx.reportFeedback({ tone: "error", message: "Abertura: sobreporia outra abertura ja existente nesta parede." });
    return;
  }

  const causeId = scopedToolId(ctx, "opening", ctx.nextSequence());
  const { recorded, error } = commitOpeningReplacement(ctx, causeId, merged.removals.length > 0 ? merged.removals : undefined, {
    wallSurfaceKey: anchor.wallSurfaceKey,
    rail: anchor.rail,
    from: merged.from,
    to: merged.to,
    bottom: merged.bottom,
    top: merged.top,
    openingKind: params.openingKind,
  });
  if (error !== undefined) {
    ctx.reportFeedback({ tone: "error", message: `Abertura: ${error}` });
    return;
  }
  if (recorded) ctx.history?.record({ kind: "transaction", transactionId: causeId });
  ctx.reportFeedback({
    tone: "success",
    message:
      merged.removals.length > 0
        ? params.openingKind === "door" ? "Portas unidas em uma so." : "Janelas unidas em uma so."
        : params.openingKind === "door" ? "Porta aberta na parede." : "Janela aberta na parede.",
  });
}

export const openingTool: ConstructionTool<"opening"> = {
  id: "opening",
  defaultParams: () => DEFAULT_TOOL_PARAMS.opening,
  previewOnHover: true,
  // Placement is read off the host wall's own rail (a travel-and-height
  // parametrization), never off raw world X/Z -- the dispatcher's
  // world-space grid magnet rounding the pointer before that projection
  // is what made a hover/drag preview jump between whole grid cells
  // instead of following the cursor. See `ConstructionTool.snapsToSurface`.
  snapsToSurface: true,

  previewFor(gesture: ToolGesture, params: OpeningParams, ctx: ToolContext) {
    if (drag !== undefined) return dragPreview(gesture, ctx, drag);
    if (creating !== undefined) return createPreview(gesture, params, ctx, creating);
    const placed = resolvePlacement(ctx, gesture.current, params);
    if (placed === undefined) return undefined;
    return ringPreview(placed.rail, placed, OPENING_COLOR[params.openingKind]);
  },

  /**
   * Press on an existing opening starts a drag (see `beginGrab`); press
   * anywhere else on a wall anchors a brand-new opening being drawn --
   * `onPointerUp` below reads the release point as its opposite corner
   * (see `dragRect`), the same press-drag-release shape every other
   * construction tool draws a shape with.
   */
  onPointerDown(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
    drag = undefined;
    creating = undefined;
    grabbedThisGesture = false;
    createdThisGesture = false;
    const opening = openingUnder(ctx, sample);
    if (opening !== undefined) {
      if (beginGrab(ctx, opening, sample, params)) {
        grabbedThisGesture = true;
      } else {
        ctx.reportFeedback({ tone: "error", message: "Nao foi possivel identificar a parede desta abertura." });
      }
      return;
    }
    const surfaceKey = wallUnder(ctx, sample);
    if (surfaceKey === undefined) return;
    const topology = ctx.runtime.getRegionTopology(surfaceKey);
    if (topology === undefined) return;
    const rail = panelRailOf(ctx.runtime, topology);
    if (rail === undefined) return;
    creating = { wallSurfaceKey: surfaceKey, rail, travel: rail.travelTo(sample.point), y: sample.point.y };
  },

  // No-op: `previewFor` already redraws the live ghost every move via the
  // dispatcher's own throttle; the actual rim replace/place only happens
  // once, on release, matching every other tool's single-commit-per-gesture
  // shape.
  onPointerMove(): void {},

  onPointerUp(ctx: ToolContext, gesture: ToolGesture, params: OpeningParams): void {
    if (drag !== undefined) {
      const active = drag;
      drag = undefined;
      commitDrag(ctx, gesture, active);
      return;
    }
    if (creating !== undefined) {
      const anchor = creating;
      creating = undefined;
      // A plain click (no real drag) never reaches here as a place -- it is
      // left to `onClick` below, which centers the tool's own slider
      // width/height on the single point clicked instead of a degenerate,
      // barely-dragged rect.
      const moved =
        Math.hypot(
          gesture.current.point.x - gesture.start.point.x,
          gesture.current.point.y - gesture.start.point.y,
          gesture.current.point.z - gesture.start.point.z,
        ) > CREATE_DRAG_THRESHOLD;
      if (moved) {
        createdThisGesture = true;
        commitCreateDrag(ctx, gesture, params, anchor);
      }
    }
  },

  onClick(ctx: ToolContext, sample: PointerSample, params: OpeningParams): void {
    // A press+release that grabbed an existing opening, or that already drew
    // and placed a new one, already ran through `onPointerUp` above -- this
    // trailing native click must never also try to stamp a second one.
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
    const wall = ctx.runtime.getRegionTopology(placed.surfaceKey);
    if (wall === undefined) return;
    const merged = mergeWithNeighbors(ctx, wall, placed.rail, params.openingKind, placed);
    if (openingOverlapsSibling(placed.rail, wall, merged.from, merged.to, merged.bottom, merged.top, merged.removals.map((r) => r.holeIndex))) {
      ctx.reportFeedback({ tone: "error", message: "Abertura: sobreporia outra abertura ja existente nesta parede." });
      return;
    }

    const causeId = scopedToolId(ctx, "opening", ctx.nextSequence());
    const { recorded, error } = commitOpeningReplacement(ctx, causeId, merged.removals.length > 0 ? merged.removals : undefined, {
      wallSurfaceKey: placed.surfaceKey,
      rail: placed.rail,
      from: merged.from,
      to: merged.to,
      bottom: merged.bottom,
      top: merged.top,
      openingKind: params.openingKind,
    });
    if (error !== undefined) {
      ctx.reportFeedback({ tone: "error", message: `Abertura: ${error}` });
      return;
    }
    if (recorded) ctx.history?.record({ kind: "transaction", transactionId: causeId });
    ctx.reportFeedback({
      tone: "success",
      message:
        merged.removals.length > 0
          ? params.openingKind === "door" ? "Portas unidas em uma so." : "Janelas unidas em uma so."
          : params.openingKind === "door" ? "Porta aberta na parede." : "Janela aberta na parede.",
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
    creating = undefined;
    clearSelection(ctx);
  },
};

interface Placement {
  readonly surfaceKey: ConstructionSurfaceKey;
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
  const placed = rimCorners(rail, rail.travelTo(sample.point), paramsAt(rail, sample.point, params));
  return placed === undefined
    ? undefined
    : { surfaceKey, rail, from: placed.from, to: placed.to, bottom: placed.bottom, top: placed.top };
}
