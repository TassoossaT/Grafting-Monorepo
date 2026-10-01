import { fitPath, type ConstructionToolId, type FittedEdge, type PreviewDescriptor } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import { buildFrameAt, frameRectangle, frameStart, pointerOnLevel, snappedInFrame, type BuildFrame } from "./build-frame.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { polylineSegmentsPreview, segmentsPreview } from "../shapes/preview-shapes.ts";
import { circleContour, previewOutline } from "../tower/tower-geometry.ts";

/** The shapes a closed outline is drawn as. */
export type ContourShape = "rectangle" | "polygon" | "freehand" | "circle";

/** What the stroke reads of a tool's parameters. */
export interface ContourStrokeParams {
  readonly shape?: ContourShape;
  readonly radius?: number;
  readonly tolerance?: number;
}

/**
 * How a tool uses the contour stroke: the level each outline is drawn on,
 * and what it makes of an outline once it is closed.
 */
export interface ContourStrokeOptions<P extends ContourStrokeParams> {
  /** The level a stroke begun at `first` draws on. */
  readonly levelAt: (ctx: ToolContext, first: PointerSample, params: P) => number;
  /** Takes a closed outline on `level`; `samples` are what drew it -- the corners, or the pointer's path. */
  readonly commit: (ctx: ToolContext, contour: readonly FittedEdge[], level: number, params: P, samples: readonly PointerSample[]) => void;
  /** A preview of a closed outline, when the tool shows more than the outline itself. */
  readonly previewClosed?: (ctx: ToolContext, outline: readonly ConstructionPosition[], level: number, params: P) => PreviewDescriptor | undefined;
  readonly color: number;
  /** What a plain click with a dragged shape says. */
  readonly dragHint?: (shape: ContourShape) => string;
}

/**
 * A closed outline drawn on one level, as any tool that lays out an area
 * draws it: a rectangle dragged corner to corner, a polygon clicked corner
 * by corner, a freehand loop fitted into lines and arcs, or a circle
 * clicked at its centre. Squared shapes are laid along the frame the stroke
 * began in -- a structure's own sides next to it, else the way the camera
 * looks (`build-frame.ts`) -- never the world's fixed axes. What the
 * outline becomes is the tool's own business.
 */
export function contourStroke<K extends ConstructionToolId, P extends ContourStrokeParams>(options: ContourStrokeOptions<P>): Pick<ConstructionTool<K>, "previewFor" | "onClick" | "onPointerUp" | "onCancel" | "rulerAnchor"> {
  const drafts = new WeakMap<object, { key: string; points: PointerSample[]; frame?: BuildFrame }>();
  const frames = new WeakMap<PointerSample, BuildFrame>();
  const draftOf = (ctx: ToolContext, params: P) => {
    const key = JSON.stringify(params);
    let current = drafts.get(ctx.runtime);
    if (!current || current.key !== key) {
      current = { key, points: [] };
      drafts.set(ctx.runtime, current);
    }
    return current;
  };
  const frameOf = (ctx: ToolContext, start: PointerSample) => {
    let frame = frames.get(start);
    if (!frame) {
      frame = buildFrameAt(ctx, start);
      frames.set(start, frame);
    }
    return frame;
  };
  const at = (sample: PointerSample, point: ConstructionPosition): PointerSample => ({ ...sample, point });
  /** The rectangle dragged from `a` to `b`, in the frame the drag began in; `undefined` when it has no area. */
  const rectangle = (ctx: ToolContext, a: PointerSample, b: PointerSample, level: number) => {
    const frame = frameOf(ctx, a);
    const corners = frameRectangle(ctx, frame, frameStart(ctx, frame, a, level), pointerOnLevel(b, level), level);
    return corners && corners.map((corner, i) => (i === 0 ? at(a, corner) : { point: corner }));
  };
  /** A polygon's next corner: its first starts the frame, every later one snaps in it. */
  const polygonCorner = (ctx: ToolContext, params: P, sample: PointerSample, level: number): PointerSample => {
    const current = draftOf(ctx, params);
    if (!current.frame || current.points.length === 0) {
      const frame = buildFrameAt(ctx, sample);
      if (current.points.length === 0) current.frame = frame;
      return at(sample, frameStart(ctx, frame, sample, level));
    }
    return sample.nodeId ? sample : at(sample, snappedInFrame(ctx, current.frame, pointerOnLevel(sample, level)));
  };
  const onLevel = (samples: readonly PointerSample[], level: number) => samples.map((s) => (s.nodeId ? s : at(s, pointerOnLevel(s, level))));
  const lines = (samples: readonly PointerSample[], level: number): FittedEdge[] => {
    const points = samples.map((s) => ({ ...s.point, y: level })).filter((p, i, all) => i === 0 || p.x !== all[i - 1]!.x || p.z !== all[i - 1]!.z);
    if (points.length > 1 && points[0]!.x === points.at(-1)!.x && points[0]!.z === points.at(-1)!.z) points.pop();
    return points.map((start, i) => ({ start, end: points[(i + 1) % points.length]!, geometry: { kind: "line" } }));
  };
  return {
    // A polygon's next side runs from the last corner clicked. Asked often, so it only looks: it never starts a draft.
    rulerAnchor(ctx, params) {
      const own = params as unknown as P;
      if ((own.shape ?? "rectangle") !== "polygon") return undefined;
      const current = drafts.get(ctx.runtime);
      return current && current.key === JSON.stringify(own) ? current.points.at(-1)?.point : undefined;
    },
    onCancel(ctx) {
      drafts.delete(ctx.runtime);
    },
    previewFor(gesture: ToolGesture, params, ctx) {
      const own = params as unknown as P;
      const points = draftOf(ctx, own).points;
      const level = options.levelAt(ctx, points[0] ?? gesture.start, own);
      const shape = own.shape ?? "rectangle";
      if (shape === "rectangle" && gesture.start.point.x === gesture.current.point.x && gesture.start.point.z === gesture.current.point.z) return undefined;
      if (shape === "circle") return segmentsPreview(previewOutline({ ...gesture.current.point, y: level }, own.radius ?? 2.5, 48), options.color);
      const samples = shape === "rectangle" ? rectangle(ctx, gesture.start, gesture.current, level)
        : shape === "polygon" ? [...points, polygonCorner(ctx, own, gesture.current, level)]
        : onLevel(gesture.samples, level);
      if (!samples) return undefined;
      const outline = samples.map((s) => ({ ...s.point, y: level }));
      if (shape !== "polygon" && outline.length > 2) {
        const closed = options.previewClosed?.(ctx, outline, level, own);
        if (closed) return closed;
      }
      return polylineSegmentsPreview(outline.length > 2 ? [...outline, outline[0]!] : outline, options.color);
    },
    onClick(ctx, sample, params) {
      const own = params as unknown as P;
      const shape = own.shape ?? "rectangle";
      if (shape === "circle") {
        const level = options.levelAt(ctx, sample, own);
        const center = frameStart(ctx, buildFrameAt(ctx, sample), sample, level);
        options.commit(ctx, circleContour({ ...center, y: level }, own.radius ?? 2.5), level, own, []);
      } else if (shape === "polygon") {
        const points = draftOf(ctx, own).points;
        const first = points[0];
        if (first && points.length >= 3 && Math.hypot(first.point.x - sample.point.x, first.point.z - sample.point.z) < 0.25) {
          const level = options.levelAt(ctx, first, own);
          options.commit(ctx, lines(points, level), level, own, [...points]);
          points.length = 0;
        } else {
          points.push(polygonCorner(ctx, own, sample, options.levelAt(ctx, first ?? sample, own)));
          ctx.reportFeedback({ tone: "info", message: "Marque os cantos e clique no primeiro para fechar. Esc cancela." });
        }
      } else if (options.dragHint) {
        ctx.reportFeedback({ tone: "info", message: options.dragHint(shape) });
      }
    },
    onPointerUp(ctx, gesture, params) {
      const own = params as unknown as P;
      const shape = own.shape ?? "rectangle";
      if (shape === "circle" || shape === "polygon" || gesture.samples.length < 2) return;
      const level = options.levelAt(ctx, gesture.start, own);
      if (shape === "rectangle") {
        const corners = rectangle(ctx, gesture.start, gesture.current, level);
        if (!corners) {
          ctx.reportFeedback({ tone: "error", message: "Arraste na diagonal para desenhar uma área." });
          return;
        }
        options.commit(ctx, lines(corners, level), level, own, corners);
      } else {
        const samples = onLevel(gesture.samples, level);
        const points = samples.map((s) => s.point);
        const first = points[0]!, last = points.at(-1)!;
        if (Math.hypot(first.x - last.x, first.z - last.z) > 1e-5) points.push(first);
        options.commit(ctx, fitPath(points, own.tolerance ?? 0.15, { curves: "arc" }), level, own, samples);
      }
      drafts.delete(ctx.runtime);
    },
  };
}
