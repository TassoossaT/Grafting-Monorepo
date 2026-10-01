import { formatLength, type MeasureUnitId, type RulerGuide } from "../../../../features/edit-construction/index.ts";
import type { PreviewDescriptor } from "../../../../features/edit-construction/index.ts";
import type { RulerFeedback } from "./ruler-session.ts";

/** The channel the ruler draws its guides on, apart from any tool's own ghost. */
export const RULER_PREVIEW_CHANNEL = "ruler-guides";

const GUIDE_COLOR = 0x7dd3fc;
const GUIDE_OPACITY = 0.85;
/** Half the length of the tick marking a corner, and of the dash marking a level. */
const TICK = 0.18;

type Point = { readonly x: number; readonly y: number; readonly z: number };

const segment = (out: number[], a: Point, b: Point): void => { out.push(a.x, a.y, a.z, b.x, b.y, b.z); };

function drawGuide(out: number[], guide: RulerGuide): void {
  switch (guide.kind) {
    case "point":
      // A cross over the corner it caught.
      segment(out, { ...guide.at, x: guide.at.x - TICK }, { ...guide.at, x: guide.at.x + TICK });
      segment(out, { ...guide.at, z: guide.at.z - TICK }, { ...guide.at, z: guide.at.z + TICK });
      return;
    case "run":
      segment(out, guide.a, guide.b);
      return;
    case "align":
      segment(out, guide.from, guide.to);
      return;
    case "length":
      segment(out, guide.run[0], guide.run[1]);
      return;
    case "level":
      segment(out, { ...guide.at, y: guide.y, x: guide.at.x - TICK }, { ...guide.at, y: guide.y, x: guide.at.x + TICK });
      return;
  }
}

/** The guides and the gap lines of `feedback` as one ghost; `undefined` when there is nothing to draw. */
export function rulerPreview(feedback: RulerFeedback): PreviewDescriptor | undefined {
  const positions: number[] = [];
  for (const guide of feedback.guides) drawGuide(positions, guide);
  for (const measure of feedback.measures) if (measure.kind === "gap") segment(positions, measure.from, measure.to);
  return positions.length === 0 ? undefined : { kind: "segments", positions: Float32Array.from(positions), color: GUIDE_COLOR, opacity: GUIDE_OPACITY };
}

/** What `feedback` says in words, in the table's `unit`: the length drawn, the gap to the nearest corner, a matched length or level. */
export function rulerLabels(feedback: RulerFeedback, unit: MeasureUnitId): readonly string[] {
  const labels: string[] = [];
  for (const measure of feedback.measures) labels.push(measure.kind === "length" ? formatLength(measure.meters, unit) : `↔ ${formatLength(measure.meters, unit)}`);
  for (const guide of feedback.guides) {
    if (guide.kind === "length") labels.push(`= ${formatLength(guide.meters, unit)}`);
    else if (guide.kind === "level") labels.push(`altura ${formatLength(guide.y, unit)}`);
  }
  return labels;
}
