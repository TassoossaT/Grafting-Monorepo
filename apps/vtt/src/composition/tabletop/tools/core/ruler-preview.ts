import { formatLength, type MeasureUnitId, type RulerGuide, type RulerMeasure } from "../../../../features/edit-construction/index.ts";
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
    case "square":
      // The side it is square to, and the line standing out from its end.
      segment(out, guide.run[0], guide.run[1]);
      segment(out, guide.from, guide.to);
      return;
    case "angle":
      // The side it follows, and the line running its way.
      segment(out, guide.run[0], guide.run[1]);
      segment(out, guide.origin, guide.to);
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
  for (const measure of feedback.measures) {
    if (measure.kind === "gap") segment(positions, measure.from, measure.to);
    // The side an angle is measured from is drawn, so what it is measured against is never a guess.
    else if (measure.kind === "angle" && measure.reference) segment(positions, measure.reference.run[0], measure.reference.run[1]);
  }
  return positions.length === 0 ? undefined : { kind: "segments", positions: Float32Array.from(positions), color: GUIDE_COLOR, opacity: GUIDE_OPACITY };
}

const signed = (value: number, write: (value: number) => string): string => `${value >= 0 ? "+" : "−"}${write(Math.abs(value))}`;
const degrees = (value: number): string => `${Math.abs(value).toFixed(1)}°`;

function measureLabel(measure: RulerMeasure, unit: MeasureUnitId): string {
  switch (measure.kind) {
    case "length": return formatLength(measure.meters, unit);
    case "gap": return `↔ ${formatLength(measure.meters, unit)}`;
    case "height": return `altura ${formatLength(measure.meters, unit)} · nível ${formatLength(measure.level, unit)}`;
    case "size": return `${measure.name} ${formatLength(measure.meters, unit)}`;
    case "change": return `${measure.name} ${signed(measure.meters, (v) => formatLength(v, unit))}`;
    case "angle": {
      const value = `${measure.name ?? "∠"} ${measure.degrees < 0 ? "−" : ""}${degrees(measure.degrees)}`;
      if (!measure.reference) return value;
      return `${value} ${measure.reference.relation === "parallel" ? "da aresta" : "do esquadro (90°) da aresta"}`;
    }
  }
}

/** What `feedback` says in words, in the table's `unit`: lengths, gaps, heights, changes and angles, and the length, direction or level it matched. */
export function rulerLabels(feedback: RulerFeedback, unit: MeasureUnitId): readonly string[] {
  const labels = feedback.measures.map((measure) => measureLabel(measure, unit));
  for (const guide of feedback.guides) {
    if (guide.kind === "length") labels.push(`= ${formatLength(guide.meters, unit)}`);
    else if (guide.kind === "level") labels.push(`altura ${formatLength(guide.y, unit)}`);
    else if (guide.kind === "angle") labels.push(guide.relation === "parallel" ? "∥ paralelo" : "⊥ perpendicular");
    else if (guide.kind === "square") labels.push(guide.relation === "perpendicular" ? "⊥ 90° da aresta" : "prolonga a aresta");
  }
  return labels;
}
