import { formatLength, type MeasureUnitId, type RulerGuide, type RulerMeasure } from "../../../../features/edit-construction/index.ts";
import type { PreviewDescriptor } from "../../../../features/edit-construction/index.ts";
import { metersFor, type RulerFeedback } from "./ruler-session.ts";

/** The channel the ruler draws its guides on, apart from any tool's own ghost. */
export const RULER_PREVIEW_CHANNEL = "ruler-guides";

const GUIDE_COLOR = 0x7dd3fc;
const GUIDE_OPACITY = 0.85;
/** How big a marker is on the screen, from its centre to its edge, in pixels. */
const MARKER_PX = 6;
/** What it is, in metres, when the scale is unknown. */
const MARKER_FALLBACK = 0.18;

type Point = { readonly x: number; readonly y: number; readonly z: number };

const segment = (out: number[], a: Point, b: Point): void => { out.push(a.x, a.y, a.z, b.x, b.y, b.z); };
const around = (c: Point, dx: number, dz: number): Point => ({ x: c.x + dx, y: c.y, z: c.z + dz });

/** A closed outline through `corners`, as segments. */
function outline(out: number[], c: Point, corners: readonly (readonly [number, number])[]): void {
  corners.forEach(([dx, dz], index) => {
    const [nx, nz] = corners[(index + 1) % corners.length]!;
    segment(out, around(c, dx, dz), around(c, nx, nz));
  });
}

/**
 * One marker shape for each thing the ruler can be on, so what is catching is
 * read at a glance, as in SketchUp's inference: a square on a corner, a
 * triangle on the middle of a side, a diamond where two lines cross.
 */
function drawGuide(out: number[], guide: RulerGuide, h: number): void {
  switch (guide.kind) {
    case "point":
      if (guide.role === "corner") outline(out, guide.at, [[-h, -h], [h, -h], [h, h], [-h, h]]);
      else outline(out, guide.at, [[-h, h], [h, h], [0, -h]]);
      return;
    case "cross":
      outline(out, guide.at, [[-h, 0], [0, -h], [h, 0], [0, h]]);
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
    case "polar":
      segment(out, guide.origin, guide.to);
      return;
    case "level":
      segment(out, around({ ...guide.at, y: guide.y }, -h, 0), around({ ...guide.at, y: guide.y }, h, 0));
      return;
  }
}

/** The guides and the gap lines of `feedback` as one ghost; `undefined` when there is nothing to draw. */
export function rulerPreview(feedback: RulerFeedback, metersPerPixel?: number): PreviewDescriptor | undefined {
  const positions: number[] = [];
  const h = metersFor(metersPerPixel, MARKER_PX, MARKER_FALLBACK, [0.04, 0.6]);
  for (const guide of feedback.guides) drawGuide(positions, guide, h);
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

/** What a guide is, in a word: what is catching. */
function guideLabel(guide: RulerGuide, unit: MeasureUnitId): string | undefined {
  switch (guide.kind) {
    case "point": return guide.role === "corner" ? "canto" : "meio da aresta";
    case "run": return "na aresta";
    case "square": return guide.relation === "perpendicular" ? "⊥ 90° da aresta" : "prolonga a aresta";
    case "align": return "alinhado";
    case "cross": return "interseção";
    case "length": return `= ${formatLength(guide.meters, unit)}`;
    case "angle": return guide.relation === "parallel" ? "∥ paralelo" : "⊥ perpendicular";
    case "polar": return `${guide.degrees.toFixed(0)}° polar`;
    case "level": return `altura ${formatLength(guide.y, unit)}`;
  }
}

/**
 * What `feedback` says in words, in the table's `unit`: first what is
 * catching -- a corner, a middle, a crossing, a direction -- then the lengths,
 * gaps, heights, changes and angles. The same thing is said once.
 */
export function rulerLabels(feedback: RulerFeedback, unit: MeasureUnitId): readonly string[] {
  const caught = new Set<string>();
  for (const guide of feedback.guides) {
    const label = guideLabel(guide, unit);
    if (label) caught.add(label);
  }
  return [...caught, ...feedback.measures.map((measure) => measureLabel(measure, unit))];
}
