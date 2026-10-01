import type { EditHistoryStack } from "@/features/edit-construction";
import type { ConstructionToolId, PreviewDescriptor, StructureEditParams, ToolParamsFor } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { TabletopRuntime } from "../../tabletop-runtime.ts";

/** What the pointer resolved to at one instant -- `nodeId` present only when it hit a node handle. */
export interface PointerSample {
  readonly point: ConstructionPosition;
  /** Screen coordinate used by explicit elevation gestures. */
  readonly screenY?: number;
  readonly screenX?: number;
  readonly shiftKey?: boolean;
  readonly nodeId?: string;
  readonly surfaceRef?: string;
  /** The pointer's ray from the camera, when the view gave one -- see `pointer-ray.ts`. */
  readonly ray?: { readonly origin: ConstructionPosition; readonly direction: ConstructionPosition };
  /** The face under the pointer, when it is on one: its slope through the exact point hit -- see `pointer-ray.ts`. */
  readonly face?: { readonly normal: ConstructionPosition; readonly centre: ConstructionPosition };
  /** How far the ruler moved the hit, in plan, to land it on a corner, side or line-up -- `pointerAtHeight` carries it onto the ray, so a tool reading the ray is ruled like one reading the point. */
  readonly ruled?: { readonly x: number; readonly z: number };
  /** The way the camera looks, when the view gave it -- see `build-frame.ts`. */
  readonly forward?: ConstructionPosition;
}

/** A gesture in progress (or, for a stationary hover, one where `start === current`). */
export interface ToolGesture {
  readonly start: PointerSample;
  readonly current: PointerSample;
  /** Ordered samples accumulated by the dispatcher; preview-only until pointer release. */
  readonly samples: readonly PointerSample[];
}

/** A finished gesture, as `onPointerUp` gets it. */
export interface ReleasedGesture extends ToolGesture {
  /** Whether the pointer travelled far enough to be a drag rather than a click -- decided once, by the dispatcher. */
  readonly moved: boolean;
  /** Which click in a quick run this release ends -- 2 for a double-click -- or 0 for a drag. Counted once, by the dispatcher. */
  readonly clicks?: number;
}

/** How far the pointer may wander, in screen pixels -- or world units when a sample has no screen position -- and still count as not having moved. */
export interface PointerSlop {
  readonly pixels: number;
  readonly world: number;
}

/** A click: the pointer barely stirred. */
const CLICK_SLOP: PointerSlop = { pixels: 3, world: 0.05 };

/** How soon a click must follow the last, in milliseconds, to count as the next in a run. */
const MULTI_CLICK_MS = 400;

/** A run of quick clicks in one place: where and when the last landed, and how many it has been. */
export interface ClickRun {
  readonly sample: PointerSample;
  readonly at: number;
  readonly count: number;
}

/** The run a click at `sample`, at time `at`, makes: the next in `previous` when soon and near enough, else a first click. */
export function nextClickRun(previous: ClickRun | undefined, sample: PointerSample, at: number): ClickRun {
  const continues = previous !== undefined && at - previous.at <= MULTI_CLICK_MS && !gestureMoved(previous.sample, [sample]);
  return { sample, at, count: continues ? previous.count + 1 : 1 };
}

/** Whether any of `samples` strayed from `start` past `slop` -- a click's, unless said otherwise. */
export function gestureMoved(start: PointerSample, samples: readonly PointerSample[], slop: PointerSlop = CLICK_SLOP): boolean {
  return samples.some((sample) =>
    sample.screenX !== undefined && sample.screenY !== undefined && start.screenX !== undefined && start.screenY !== undefined
      ? Math.hypot(sample.screenX - start.screenX, sample.screenY - start.screenY) > slop.pixels
      : Math.hypot(sample.point.x - start.point.x, sample.point.y - start.point.y, sample.point.z - start.point.z) > slop.world,
  );
}

export interface ConstructionToolFeedback {
  readonly tone: "info" | "success" | "error";
  readonly message: string;
  readonly surfaceRef?: string;
}
/** What every tool implementation is handed to act -- the runtime to call, undo/redo history for the one tool that uses it, and a salt generator so repeated commits never collide (mirrors `tabletop-entry.tsx`'s retired `generateCountRef`). */
export interface ToolContext {
  readonly runtime: TabletopRuntime;
  readonly history: EditHistoryStack;
  readonly tableId: string;
  /**
   * Whether the ruler's snap is on. The ruler itself is always there while
   * building -- its guides and measures show either way; this only says
   * whether what it catches is taken. The dispatcher has already ruled every
   * ground point by the time a tool sees it, and a tool that rules a point of
   * its own (a build frame's corner, a far side) asks `ruler-session.ts`
   * rather than re-deriving a link.
   */
  readonly rulerSnap: boolean;
  /** Shows what the ruler caught for a point a tool ruled itself -- a handle dragged onto a corner -- until the gesture ends; `undefined` clears it. */
  readonly showRuler?: (feedback: import("./ruler-session.ts").RulerFeedback | undefined) => void;
  /**
   * How a grab on an existing structure behaves -- shape/elevation mode and
   * the bezier handle options (`curveMode`/`curveAction`/`curveWidth`).
   * Ambient like `rulerSnap`: every construction tool can grab and edit
   * whatever it owns (`structure-edit-behavior.ts`), so this is no longer
   * one tool's own params.
   */
  readonly structureEditParams: StructureEditParams;
  /** A fresh integer each call, monotonically increasing for the runtime's lifetime -- feeds id-namespacing salts and cell/room indices, mirroring `tabletop-entry.tsx`'s retired `generateCountRef`. */
  nextSequence(): number;
  /** Reports the node a tool just selected/moved, for `SettingsDrawer`'s inspector. `undefined` clears the inspector. */
  reportSelection(info: { readonly id: string; readonly point: ConstructionPosition } | undefined): void;
  reportFeedback(feedback: ConstructionToolFeedback | undefined): void;
  /**
   * Rewrites a tool's own params as the params panel would, so a tool can
   * show its selection's settings there. Absent where no panel exists.
   */
  updateToolParams?<Id extends ConstructionToolId>(toolId: Id, update: (current: ToolParamsFor<Id>) => ToolParamsFor<Id>): void;
}

/**
 * One construction tool's behavior, generic over its own parameter shape.
 * Every hook is optional -- a tool implements only the lifecycle stages it
 * actually uses (a click-only tool has no `onPointerUp`, it commits
 * on `onClick`). `composition/tabletop/use-construction-pointer.ts` is the
 * only caller and never branches on `id` -- it just invokes whichever hook
 * the active tool defines.
 */
export interface ConstructionTool<Id extends ConstructionToolId> {
  readonly id: Id;
  /** Presentation and sampling policy while this tool is active. */
  readonly handlePresentation?: "spine-points";
  /** The types this tool edits once they stand -- the scene shows their whole-structure handles while it is active. */
  readonly editsType?: (surfaceType: string) => boolean;
  /**
   * What this tool edits is edited only by its handles, never by grabbing
   * its geometry -- so a press on it builds against it -- and those handles
   * show only on the structure under the pointer.
   */
  readonly handlesOnHover?: boolean;
  /** How this tool's dragged spine anchors snap -- the scene manipulator uses it too. */
  readonly anchorSnap?: import("./curve-edit-gesture.ts").AnchorSnap;
  /** `false` for a tool the ruler leaves alone: terrain is what is built on, and a tool laying itself out in a frame of its own rules its points itself. */
  readonly usesRuler?: boolean;
  defaultParams(): ToolParamsFor<Id>;
  /** Opt in to a stationary drawing preview between gestures. */
  readonly previewOnHover?: boolean | ((params: ToolParamsFor<Id>) => boolean);
  /**
   * This tool always projects the pointer onto an existing surface's own
   * parametrization (a wall's rail, say) rather than reading raw world X/Z --
   * so the dispatcher's world-space grid magnet, applied before any tool
   * ever sees the point, is redundant at best. At worst it is actively
   * harmful: rounding X/Z to a world grid *before* a nonlinear projection
   * (onto a rotated or curved rail) can jump the projected result across
   * much more than one grid cell, which reads as the pointer "teleporting"
   * rather than the smooth follow every other tool gets from the same
   * magnet. A tool that opts in reads its own samples unsnapped and is
   * responsible for whatever continuity it wants.
   */
  readonly snapsToSurface?: boolean;
  /** The tool's not-yet-committed ghost for the current gesture (or stationary hover, when `gesture.start === gesture.current`). */
  previewFor?(gesture: ToolGesture, params: ToolParamsFor<Id>, ctx: ToolContext): PreviewDescriptor | undefined;
  /** Left-button press. Continuous tools (brushes, move-node) start their gesture here. */
  onPointerDown?(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>): void;
  /** Called while a gesture is active (left button held). Brushes that paint continuously (terrain) commit here, throttled by the dispatcher. */
  onPointerMove?(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void;
  /** Gesture end. Tools that commit a single shape from a drag (wall, move-node's history entry) act here. */
  onPointerUp?(ctx: ToolContext, gesture: ReleasedGesture, params: ToolParamsFor<Id>): void;
  /** Discards an unfinished tool draft on Escape, cancellation or tool switch. */
  onCancel?(ctx: ToolContext): void;
  /** Handles a tool key outside text controls; true prevents the browser default. */
  onKeyDown?(ctx: ToolContext, key: string, params: ToolParamsFor<Id>): boolean;
  /** Delete/Backspace with the tool active -- a tool holding a selection (an opening picked for editing, say) removes it here. */
  onDeleteKey?(ctx: ToolContext): void;
  /** The active tool's params changed (the panel, or `updateToolParams`) -- a tool holding a selection may apply them to it. */
  onParamsChange?(ctx: ToolContext, next: ToolParamsFor<Id>, previous: ToolParamsFor<Id>): void;
  /** A press+release with no intervening drag. Batch/stamp tools (room) commit here instead of `onPointerUp`. */
  onClick?(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>): void;
}

/** Builds a deterministic scoped operation/prefix ID for a given tool/domain on a table. */
export function scopedToolId(ctx: ToolContext | string, domain: string, suffix?: string | number): string {
  const tableId = typeof ctx === "string" ? ctx : ctx.tableId;
  return suffix !== undefined ? `${tableId}:${domain}:${suffix}` : `${tableId}:${domain}`;
}
