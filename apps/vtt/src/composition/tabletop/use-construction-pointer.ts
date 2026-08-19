"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import type { ConstructionToolId, MoveNodeHistoryStack, ToolParamsByTool } from "@/features/edit-construction";
import type { RenderViewId } from "@/ports";
import type { SelectedNodeInfo } from "@/widgets";

import { GRID_SNAP_UNIT } from "../../adapters/rendering/index.ts";
import type { TabletopRuntime } from "./tabletop-runtime.ts";
import { toolFor } from "./tools/tool-registry.ts";
import type { ConstructionToolFeedback, PointerSample, ToolContext } from "./tools/tool-context.ts";

/** Caps how often a continuous tool's `onPointerMove` commits during an active drag -- the preview ghost still updates on every raw event, only the (comparatively expensive) generate/mutate call is rate-limited. */
const MOVE_COMMIT_THROTTLE_MS = 32;
const PREVIEW_THROTTLE_MS = 32;

export interface UseConstructionPointerOptions {
  readonly activeTool: ConstructionToolId;
  readonly toolParams: ToolParamsByTool;
  readonly runtime: TabletopRuntime;
  readonly history: MoveNodeHistoryStack;
  readonly tableId: string;
  readonly viewId: RenderViewId | undefined;
  /** When true, a resolved point (other than an existing node handle -- those stay precise) snaps to the nearest grid intersection before any tool sees it, so a new terrain cell/wall/room lands centered on the grid instead of wherever the pointer happened to be. */
  readonly snapToGrid: boolean;
  readonly onSelectionChange: (info: SelectedNodeInfo | undefined) => void;
  readonly onFeedbackChange: (feedback: ConstructionToolFeedback | undefined) => void;
}

function snappedTo(value: number, unit: number): number {
  return Math.round(value / unit) * unit;
}

/** A node-handle hit is never snapped -- moving an existing node stays precise; only newly-resolved ground points snap. */
function applySnap(sample: PointerSample, snapToGrid: boolean): PointerSample {
  if (!snapToGrid || sample.nodeId !== undefined) return sample;
  return {
    ...sample,
    point: { x: snappedTo(sample.point.x, GRID_SNAP_UNIT), y: sample.point.y, z: snappedTo(sample.point.z, GRID_SNAP_UNIT) },
  };
}

export interface ConstructionPointerHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

interface ActiveGesture {
  readonly pointerId: number;
  readonly start: PointerSample;
  last: PointerSample;
  readonly samples: PointerSample[];
}

function pointerOffset(event: { currentTarget: HTMLElement; clientX: number; clientY: number }): {
  x: number;
  y: number;
} {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * The generic pointer/effect dispatcher: owns the pointer gesture lifecycle
 * (down/move/up/cancel/click) and the active tool's preview, but never
 * branches on *which* tool is active -- it only resolves what the pointer
 * hit, looks the active tool up in `tools/tool-registry.ts`, and calls
 * whichever lifecycle hook that tool defines. Per-tool behavior (what a
 * stroke or a click actually generates) lives entirely in `tools/*.ts`.
 */
export function useConstructionPointer(options: UseConstructionPointerOptions): ConstructionPointerHandlers {
  const gestureRef = useRef<ActiveGesture | null>(null);
  const sequenceRef = useRef(0);
  const lastCommitAtRef = useRef(0);
  const lastPreviewAtRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const nextSequence = useCallback(() => ++sequenceRef.current, []);

  useEffect(() => {
    gestureRef.current = null;
    lastCommitAtRef.current = 0;
    lastPreviewAtRef.current = 0;
    options.runtime.clearPreview();
  }, [options.activeTool, options.runtime]);


  const ctx = useMemo<ToolContext>(
    () => ({
      get runtime() {
        return optionsRef.current.runtime;
      },
      get history() {
        return optionsRef.current.history;
      },
      get tableId() {
        return optionsRef.current.tableId;
      },
      nextSequence,
      reportSelection: (info) => optionsRef.current.onSelectionChange(info),
      reportFeedback: (feedback) => optionsRef.current.onFeedbackChange(feedback),
    }),
    [nextSequence],
  );

  const sampleAt = useCallback(
    (event: { currentTarget: HTMLElement; clientX: number; clientY: number }): PointerSample | undefined => {
      const { viewId, runtime, snapToGrid } = optionsRef.current;
      if (viewId === undefined) return undefined;
      const { x, y } = pointerOffset(event);
      const hit = runtime.pick(viewId, x, y);
      return hit === undefined ? undefined : applySnap(hit, snapToGrid);
    },
    [],
  );

  /**
   * Shows the preview for the very first sample of a gesture, right as it
   * starts (`onPointerDown`) -- never for idle hovering. A preview that also
   * ran on passive `pointermove` (no button down) used to recompute and
   * reappear every time the pointer merely rested near a spot the brush
   * could still reach -- including right around a stroke you'd already
   * committed, since the brush footprint is wider than the thin path it
   * actually carves. That looked exactly like a "stuck" ghost that outlived
   * the stroke, even though `clearPreview` was firing correctly on every
   * commit and tool switch. See the tool-switch reset effect above for the
   * only other place `clearPreview` is expected to run outside a gesture.
   */
  const showStartPreview = useCallback((sample: PointerSample | undefined) => {
    const { runtime, activeTool, toolParams } = optionsRef.current;
    const tool = toolFor(activeTool);
    if (sample === undefined || tool.previewFor === undefined) {
      runtime.clearPreview();
      return;
    }
    const now = performance.now();
    if (now - lastPreviewAtRef.current < PREVIEW_THROTTLE_MS) return;
    lastPreviewAtRef.current = now;
    const params = toolParams[activeTool];
    const descriptor = tool.previewFor({ start: sample, current: sample, samples: [sample] }, params as never, ctx);
    if (descriptor === undefined) runtime.clearPreview();
    else runtime.showPreview(descriptor);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // The right and middle buttons are reserved for camera orbit/pan
      // (see `features/navigate-camera`) -- only the left button drives tools.
      if (event.button !== 0) return;
      const sample = sampleAt(event);
      if (sample === undefined) return;

      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;
      lastPreviewAtRef.current = 0;

      // Only tools that actually react to a drag capture the pointer --
      // a click-only tool leaves the native click gesture alone.
      if (tool.onPointerMove !== undefined || tool.onPointerUp !== undefined) {
        gestureRef.current = { pointerId: event.pointerId, start: sample, last: sample, samples: [sample] };
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      tool.onPointerDown?.(ctx, sample, params);
      showStartPreview(sample);
    },
    [ctx, sampleAt, showStartPreview],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;

      // No button down -- idle hovering never shows a preview, only an
      // actual drag does (see `showStartPreview`'s own doc for why).
      if (gesture === null || gesture.pointerId !== event.pointerId) {
        optionsRef.current.runtime.clearPreview();
        return;
      }

      const sample = sampleAt(event);
      if (sample === undefined) return; // pointer strayed off pickable geometry -- freeze at the last resolved position, same posture as before this refactor.
      gesture.last = sample;
      const previous = gesture.samples[gesture.samples.length - 1];
      if (previous === undefined || previous.point.x !== sample.point.x || previous.point.y !== sample.point.y || previous.point.z !== sample.point.z) {
        gesture.samples.push(sample);
      }
      const activeGesture = { start: gesture.start, current: sample, samples: gesture.samples };

      const now = performance.now();
      if (now - lastPreviewAtRef.current >= PREVIEW_THROTTLE_MS) {
        lastPreviewAtRef.current = now;
        const descriptor = tool.previewFor?.(activeGesture, params, ctx);
        if (descriptor === undefined) optionsRef.current.runtime.clearPreview();
        else optionsRef.current.runtime.showPreview(descriptor);
      }
      if (now - lastCommitAtRef.current < MOVE_COMMIT_THROTTLE_MS) return;
      lastCommitAtRef.current = now;
      tool.onPointerMove?.(ctx, activeGesture, params);
    },
    [ctx, sampleAt],
  );

  const finishGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (gesture === null || gesture.pointerId !== event.pointerId) return;
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      const params = toolParams[activeTool] as never;

      tool.onPointerUp?.(ctx, { start: gesture.start, current: gesture.last, samples: gesture.samples }, params);
      gestureRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      optionsRef.current.runtime.clearPreview();
    },
    [ctx],
  );

  const cancelGesture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    optionsRef.current.runtime.clearPreview();
  }, []);
  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const { activeTool, toolParams } = optionsRef.current;
      const tool = toolFor(activeTool);
      if (tool.onClick === undefined) return;
      const sample = sampleAt(event);
      if (sample === undefined) return;
      tool.onClick(ctx, sample, toolParams[activeTool] as never);
    },
    [ctx, sampleAt],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishGesture,
    onPointerCancel: cancelGesture,
    onClick,
  };
}
