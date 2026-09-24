import type { EditHistoryStack } from "@/features/edit-construction";
import type { ConstructionToolId, PreviewDescriptor, StructureEditParams, ToolParamsFor } from "@/features/edit-construction";
import type { ConstructionPosition } from "@/ports";

import type { TabletopRuntime } from "../../tabletop-runtime.ts";
import type { EditIntent } from "./edit-intent.ts";

/** What the pointer resolved to at one instant -- `nodeId` present only when it hit a node handle. */
export interface PointerSample {
  readonly point: ConstructionPosition;
  /** Screen coordinate used by explicit elevation gestures. */
  readonly screenY?: number;
  readonly screenX?: number;
  readonly nodeId?: string;
  readonly surfaceRef?: string;
}

/** A gesture in progress (or, for a stationary hover, one where `start === current`). */
export interface ToolGesture {
  readonly start: PointerSample;
  readonly current: PointerSample;
  /** Ordered samples accumulated by the dispatcher; preview-only until pointer release. */
  readonly samples: readonly PointerSample[];
  /** Whether the pointer travelled far enough to be a drag rather than a click -- set by the dispatcher, see {@link gestureDragged}. */
  readonly dragged?: boolean;
}

/** How far a press may wander, on screen or in the world when no screen position is known, and still be a click. */
const CLICK_SLOP_PIXELS = 3;
const CLICK_SLOP_WORLD = 0.05;

/** The one click-versus-drag decision: the dispatcher's own, when it made it, else the same rule applied to the samples. */
export function gestureDragged(gesture: ToolGesture): boolean {
  if (gesture.dragged !== undefined) return gesture.dragged;
  const { start } = gesture;
  return [...gesture.samples, gesture.current].some((sample) =>
    sample.screenX !== undefined && sample.screenY !== undefined && start.screenX !== undefined && start.screenY !== undefined
      ? Math.hypot(sample.screenX - start.screenX, sample.screenY - start.screenY) > CLICK_SLOP_PIXELS
      : Math.hypot(sample.point.x - start.point.x, sample.point.y - start.point.y, sample.point.z - start.point.z) > CLICK_SLOP_WORLD);
}

/** Screen pixels of vertical pointer travel per world unit of height in elevation mode. */
const ELEVATION_PIXELS_PER_UNIT = 40;

/** The height an elevation drag adds going from `fromScreenY` to `toScreenY` (screen Y grows downward), or `undefined` without both. */
export function elevationRise(fromScreenY: number | undefined, toScreenY: number | undefined): number | undefined {
  if (fromScreenY === undefined || toScreenY === undefined) return undefined;
  return (fromScreenY - toScreenY) / ELEVATION_PIXELS_PER_UNIT;
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
   * Whether the grid magnet is on. A fact about the session, not a
   * behaviour: the dispatcher has already rounded every ground point to a
   * grid intersection by the time a tool sees it, and this only says so, so
   * a tool that reads meaning into where its samples came from can. What
   * any tool does with it is that tool's own business.
   */
  readonly snapToGrid: boolean;
  /**
   * How a grab on an existing structure behaves -- shape/elevation mode and
   * the bezier handle options (`curveMode`/`curveAction`/`curveWidth`).
   * Ambient like `snapToGrid`: every construction tool can grab and edit
   * whatever it owns (`structure-edit-behavior.ts`), so this is no longer
   * one tool's own params.
   */
  readonly structureEditParams: StructureEditParams;
  /** A fresh integer each call, monotonically increasing for the runtime's lifetime -- feeds id-namespacing salts and cell/room indices, mirroring `tabletop-entry.tsx`'s retired `generateCountRef`. */
  nextSequence(): number;
  /** Reports the node a tool just selected/moved, for `SettingsDrawer`'s inspector. `undefined` clears the inspector. */
  reportSelection(info: { readonly id: string; readonly point: ConstructionPosition } | undefined): void;
  reportFeedback(feedback: ConstructionToolFeedback | undefined): void;
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
  defaultParams(): ToolParamsFor<Id>;
  /** Opt in to a stationary drawing preview between gestures. */
  readonly previewOnHover?: boolean;
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
  /**
   * The structure types whose edit handles this tool edits. A press on one
   * of their handles edits; every other press creates. Absent: every press
   * creates, and no handles are shown.
   */
  readonly editableType?: (surfaceType: string) => boolean;
  /** The tool's not-yet-committed ghost for the current gesture (or stationary hover, when `gesture.start === gesture.current`). */
  previewFor?(gesture: ToolGesture, params: ToolParamsFor<Id>, ctx: ToolContext): PreviewDescriptor | undefined;
  /** Left-button press. Continuous tools (brushes, move-node) start their gesture here. `intent` is what the dispatcher resolved from the hover; absent when called outside it. */
  onPointerDown?(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>, intent?: EditIntent): void;
  /** Called while a gesture is active (left button held). Brushes that paint continuously (terrain) commit here, throttled by the dispatcher. */
  onPointerMove?(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void;
  /** Gesture end. Tools that commit a single shape from a drag (wall, move-node's history entry) act here. */
  onPointerUp?(ctx: ToolContext, gesture: ToolGesture, params: ToolParamsFor<Id>): void;
  /** Discards an unfinished tool draft on Escape, cancellation or tool switch. */
  onCancel?(ctx: ToolContext): void;
  /** Delete/Backspace with the tool active -- a tool holding a selection (an opening picked for editing, say) removes it here. */
  onDeleteKey?(ctx: ToolContext): void;
  /** A press+release with no intervening drag. Batch/stamp tools (room) commit here instead of `onPointerUp`. */
  onClick?(ctx: ToolContext, sample: PointerSample, params: ToolParamsFor<Id>): void;
}

/** Builds a deterministic scoped operation/prefix ID for a given tool/domain on a table. */
export function scopedToolId(ctx: ToolContext | string, domain: string, suffix?: string | number): string {
  const tableId = typeof ctx === "string" ? ctx : ctx.tableId;
  return suffix !== undefined ? `${tableId}:${domain}:${suffix}` : `${tableId}:${domain}`;
}
