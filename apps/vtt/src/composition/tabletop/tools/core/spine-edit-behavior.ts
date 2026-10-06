import type { ConstructionToolId } from "@/features/edit-construction";

import { curveAnchorPick, curveActionPick, curveEndWidthPick, curveEdgesOf, curveHandles, curveMidframes, curvePick, curvePickId, curveWidthPick, globalHandleOf, shownGlobalHandleAt, spanWidth, spineDefaultOffsets, spineWidthHandles, structureTypeFor } from "../../../../features/edit-construction/index.ts";
import { beginCurveGesture, type AnchorSnap, type CurveGesture, type CurveGestureOptions } from "./curve-edit-gesture.ts";
import type { ConstructionTool, PointerSample, ReleasedGesture, ToolContext, ToolGesture } from "./tool-context.ts";

/**
 * Editing an existing spine by its points -- the one editor every
 * spine-built type shares, whatever surface it regenerates from the spine:
 *
 * - drag a control point, or the point manipulator the scene shows on the
 *   selected one;
 * - drag a span's midpoint to bend it, or double-click it to insert a point there;
 * - push a span's width handle out or in to widen or narrow it;
 * - Delete/Backspace removes the selected control point;
 * - contextual curve actions and a separate width handle at the span end.
 *
 * A press on the body is never an edit: it belongs to the tool, which
 * builds against what it lands on. Handles show on the spine under the
 * pointer.
 *
 * The road was first to have this, and the spiral uses the same thing; a
 * tool only says which spine owners it edits, never how.
 */
export interface SpineEditOptions {
  /** Only spines owned by a type this accepts are edited; anything else falls through to the tool. */
  readonly ownsSpine: (surfaceType: string) => boolean;
  /** While this answers true -- a tool midway through drawing -- presses belong to the tool, except on a handle, which drops the draft and edits. */
  readonly drafting?: (ctx: ToolContext) => boolean;
  /** How a dragged anchor snaps; absent, anchors never snap. */
  readonly snap?: AnchorSnap;
}

/** What a press on a spine resolved to: the handle it actually takes, and how to drag it. */
interface SpinePick {
  readonly sample: PointerSample;
  readonly options: CurveGestureOptions;
}

interface SpineEditBehavior {
  /** The handle of an owned spine `sample` lands on -- a control point, a midpoint, a width handle or a whole-structure handle. */
  pick(ctx: ToolContext, sample: PointerSample): SpinePick | undefined;
  /** Whether `sample` is any curve handle of an owned spine, including one this editor does not drag. */
  isHandle(ctx: ToolContext, sample: PointerSample): boolean;
  /** Selects and starts dragging `picked`; false when the curve refused the gesture. */
  begin(ctx: ToolContext, picked: SpinePick): boolean;
  move(ctx: ToolContext, gesture: ToolGesture): boolean;
  /** Ends and commits an active drag -- a double-click on a midpoint inserts a point there; false when none was active. */
  end(ctx: ToolContext, gesture: ReleasedGesture): boolean;
  isActive(ctx: ToolContext): boolean;
  /** Drops an active drag without committing it, keeping the selection. */
  abort(ctx: ToolContext): void;
  select(ctx: ToolContext, sample?: PointerSample): void;
  /** Removes the selected control point; false when nothing was selected. */
  removeSelected(ctx: ToolContext): boolean;
  /** Drops any drag and the selection. */
  cancel(ctx: ToolContext): void;
}

/** A handle's drag: past a few pixels, and keeping where on the handle the pointer took it. */
const dragOf = (sample: PointerSample, extra: Partial<CurveGestureOptions> = {}): CurveGestureOptions => ({ mode: "shape", insertOnClick: false, dragThreshold: 5, pointerOrigin: sample.point, ...extra });
const sceneOf = (ctx: ToolContext) => ({ graph: ctx.runtime.getGraphSnapshot(), topologies: ctx.runtime.getAllRegionTopologies(), cloudFor: ctx.runtime.cloudFor.bind(ctx.runtime) });

function createSpineEditBehavior({ ownsSpine, snap }: SpineEditOptions): SpineEditBehavior {
  const drags = new WeakMap<ToolContext["runtime"], { readonly edit: CurveGesture; readonly picked: SpinePick }>();
  const selections = new WeakMap<ToolContext["runtime"], string>();
  const owned = (surfaceType: string | undefined) => surfaceType !== undefined && structureTypeFor(surfaceType)?.spine !== undefined && ownsSpine(surfaceType);

  function select(ctx: ToolContext, sample?: PointerSample): void {
    if (sample?.nodeId) selections.set(ctx.runtime, sample.nodeId); else selections.delete(ctx.runtime);
    ctx.reportSelection(sample?.nodeId ? { id: sample.nodeId, point: sample.point } : undefined);
  }

  function beginEdit(ctx: ToolContext, sample: PointerSample, options: CurveGestureOptions): CurveGesture | undefined {
    return beginCurveGesture({ ...ctx, reportSelection: (info) => select(ctx, info && { nodeId: info.id, point: info.point }) }, sample, owned, snap ? { ...options, snap } : options);
  }

  /** A control point or span midpoint of an owned spine, placed where the handle actually is. */
  function handleTarget(ctx: ToolContext, sample: PointerSample): PointerSample | undefined {
    if (!sample.nodeId) return;
    const graph = ctx.runtime.getGraphSnapshot();
    const edges = graph.edges.filter((e) => owned(e.curve?.surfaceType));
    const pick = curvePick(sample.nodeId);
    if (pick) {
      if (pick.index !== "midpoint") return;
      const edge = edges.find((e) => e.edgeId === pick.edgeId);
      const handle = edge && curveHandles(curveMidframes(curveEdgesOf({ ...graph, edges: [edge] }, [], ctx.runtime), ctx.runtime))[0];
      return handle && { ...sample, point: handle.position };
    }
    const anchorId = curveAnchorPick(sample.nodeId);
    if (!anchorId || !edges.some((e) => e.startNodeId === anchorId || e.endNodeId === anchorId)) return;
    const node = graph.nodes.find((n) => n.id === anchorId);
    return node && { ...sample, nodeId: anchorId, point: node.position };
  }

  /** A span's width handle, standing where it is drawn: a width drag of that span. */
  function widthPick(ctx: ToolContext, sample: PointerSample, edgeId: string, atEnd = false): SpinePick | undefined {
    const graph = ctx.runtime.getGraphSnapshot();
    const edge = graph.edges.find((e) => e.edgeId === edgeId && owned(e.curve?.surfaceType));
    const width = edge && spanWidth(edge, spineDefaultOffsets);
    if (!width) return undefined;
    const frames = curveMidframes(curveEdgesOf({ ...graph, edges: [edge] }, [], ctx.runtime), ctx.runtime);
    const handle = spineWidthHandles(frames, graph, spineDefaultOffsets)[0];
    const defaults = edge?.curve?.surfaceType ? spineDefaultOffsets(edge.curve.surfaceType) : undefined;
    const startOffsets = edge?.curve?.bandOffsets ?? defaults;
    const endOffsets = edge?.curve?.endBandOffsets ?? startOffsets;
    const endWidth = endOffsets && endOffsets[1] - endOffsets[0];
    return handle && {
      sample: { ...sample, nodeId: curvePickId(edgeId, "midpoint"), point: atEnd ? sample.point : handle.position },
      options: dragOf(sample, { curveAction: "width", curveWidth: atEnd && startOffsets ? startOffsets[1] - startOffsets[0] : width.width, ...(atEnd ? { curveEndWidth: endWidth, widthAtEnd: true } : {}), allowShapeChange: true }),
    };
  }

  return {
    pick(ctx, sample) {
      const action = sample.nodeId ? curveActionPick(sample.nodeId) : undefined;
      if (action) {
        if (action.action === "create") return;
        const graph = ctx.runtime.getGraphSnapshot();
        const midpoint = curvePick(action.targetId);
        const owner = midpoint ? graph.edges.find((edge) => edge.edgeId === midpoint.edgeId)?.curve?.surfaceType : graph.edges.find((edge) => edge.startNodeId === action.targetId || edge.endNodeId === action.targetId)?.curve?.surfaceType;
        if (!owned(owner)) return;
        return { sample: { ...sample, nodeId: action.targetId }, options: dragOf(sample, { curveAction: action.action, allowShapeChange: true }) };
      }
      const endWidthOf = sample.nodeId ? curveEndWidthPick(sample.nodeId) : undefined;
      if (endWidthOf) return widthPick(ctx, sample, endWidthOf, true);
      const widthOf = sample.nodeId ? curveWidthPick(sample.nodeId) : undefined;
      if (widthOf !== undefined) return widthPick(ctx, sample, widthOf);
      if (sample.nodeId && globalHandleOf(sample.nodeId)) {
        const handle = shownGlobalHandleAt(sceneOf(ctx), sample.nodeId);
        return handle && owned(handle.owner)
          ? { sample: { ...sample, point: handle.position }, options: dragOf(sample) }
          : undefined;
      }
      const target = handleTarget(ctx, sample);
      if (target) {
        const control = curvePick(target.nodeId!) !== undefined;
        return { sample: target, options: control ? dragOf(sample, { curveMode: "free" }) : dragOf(sample) };
      }
      return undefined;
    },
    isHandle(ctx, sample) {
      if (sample.nodeId && globalHandleOf(sample.nodeId)) return owned(shownGlobalHandleAt(sceneOf(ctx), sample.nodeId)?.owner);
      if (sample.nodeId && (curveAnchorPick(sample.nodeId) || curveActionPick(sample.nodeId))) return this.pick(ctx, sample) !== undefined;
      const edgeId = sample.nodeId ? curveEndWidthPick(sample.nodeId) ?? curveWidthPick(sample.nodeId) ?? curvePick(sample.nodeId)?.edgeId : undefined;
      return edgeId !== undefined && owned(ctx.runtime.getGraphSnapshot().edges.find((e) => e.edgeId === edgeId)?.curve?.surfaceType);
    },
    begin(ctx, picked) {
      select(ctx, picked.sample);
      const edit = beginEdit(ctx, picked.sample, picked.options);
      if (edit) drags.set(ctx.runtime, { edit, picked });
      return edit !== undefined;
    },
    move(ctx, gesture) {
      const drag = drags.get(ctx.runtime);
      if (!drag) return false;
      drag.edit.move(gesture);
      return true;
    },
    end(ctx, gesture) {
      const drag = drags.get(ctx.runtime);
      if (!drag) return false;
      drags.delete(ctx.runtime);
      drag.edit.move(gesture);
      drag.edit.commit();
      // The second click of a double-click on a span's midpoint inserts a point there, the curve unchanged.
      const { sample, options } = drag.picked;
      if (!gesture.moved && (gesture.clicks ?? 0) >= 2 && (!options.curveAction || options.curveAction === "edit") && curvePick(sample.nodeId!)?.index === "midpoint") {
        beginEdit(ctx, sample, { ...options, insertOnClick: true })?.commit();
      }
      return true;
    },
    isActive: (ctx) => drags.has(ctx.runtime),
    abort(ctx) {
      drags.get(ctx.runtime)?.edit.cancel();
      drags.delete(ctx.runtime);
    },
    select,
    removeSelected(ctx) {
      const id = selections.get(ctx.runtime);
      // A global handle stands for the whole spine; deleting a spine is not a point removal.
      if (!id || globalHandleOf(id)) return false;
      const node = ctx.runtime.getGraphSnapshot().nodes.find((n) => n.id === id);
      if (!node) { select(ctx); return false; }
      beginEdit(ctx, { nodeId: id, point: node.position }, { mode: "shape", curveAction: "remove-anchor", allowShapeChange: true })?.commit();
      select(ctx);
      return true;
    },
    cancel(ctx) {
      this.abort(ctx);
      select(ctx);
    },
  };
}

/**
 * Composes a creation tool with the spine editor above: a press on
 * a spine this tool owns edits it, and a press anywhere else is the tool's
 * own creation gesture, unchanged -- the spine counterpart of
 * `withStructureEditing`.
 */
export function withSpineEditing<Id extends ConstructionToolId>(tool: ConstructionTool<Id>, options: SpineEditOptions): ConstructionTool<Id> {
  const spine = createSpineEditBehavior(options);
  const claimed = new WeakMap<ToolContext["runtime"], boolean>();
  const report = (ctx: ToolContext, error: unknown) => {
    spine.abort(ctx);
    ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
  };
  return {
    ...tool,
    handlePresentation: "spine-points",
    editsType: options.ownsSpine,
    handlesOnHover: true,
    ...(options.snap ? { anchorSnap: options.snap } : {}),
    previewFor(gesture, params, ctx) {
      return spine.isActive(ctx) ? undefined : tool.previewFor?.(gesture, params, ctx);
    },
    onPointerDown(ctx, sample, params) {
      claimed.delete(ctx.runtime);
      try {
        const action = sample.nodeId ? curveActionPick(sample.nodeId) : undefined;
        if (action?.action === "create") {
          claimed.set(ctx.runtime, true);
          const picked = spine.pick(ctx, { ...sample, nodeId: action.targetId });
          if (picked && tool.startFrom) {
            spine.cancel(ctx);
            tool.startFrom(ctx, picked.sample, params);
          }
          return;
        }
        // A handle always edits: a draft waiting for its next press is dropped, never drawn from it.
        const picked = spine.pick(ctx, sample);
        if (picked) { if (options.drafting?.(ctx)) tool.onCancel?.(ctx); claimed.set(ctx.runtime, true); spine.begin(ctx, picked); return; }
        if (options.drafting?.(ctx)) { tool.onPointerDown?.(ctx, sample, params); return; }
        // A tangent handle this editor does not drag still belongs to the spine, not to a new structure.
        if (spine.isHandle(ctx, sample)) { claimed.set(ctx.runtime, true); spine.select(ctx); return; }
      } catch (error) { report(ctx, error); return; }
      spine.select(ctx);
      tool.onPointerDown?.(ctx, sample, params);
    },
    onPointerMove(ctx, gesture, params) {
      try { if (spine.move(ctx, gesture)) return; } catch (error) { report(ctx, error); return; }
      if (!claimed.get(ctx.runtime)) tool.onPointerMove?.(ctx, gesture, params);
    },
    onPointerUp(ctx, gesture, params) {
      try { if (spine.end(ctx, gesture)) return; } catch (error) { report(ctx, error); return; }
      if (!claimed.get(ctx.runtime)) tool.onPointerUp?.(ctx, gesture, params);
    },
    onClick(ctx, sample, params) {
      if (claimed.get(ctx.runtime)) return;
      tool.onClick?.(ctx, sample, params);
    },
    onKeyDown(ctx, key, params) {
      if (tool.onKeyDown?.(ctx, key, params)) return true;
      if (spine.isActive(ctx) || (key !== "Delete" && key !== "Backspace")) return false;
      try { return spine.removeSelected(ctx); } catch (error) { report(ctx, error); return true; }
    },
    onCancel(ctx) {
      spine.cancel(ctx);
      claimed.delete(ctx.runtime);
      tool.onCancel?.(ctx);
    },
  };
}
