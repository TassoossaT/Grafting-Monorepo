import { DEFAULT_MEASURE_UNIT, MEASURE_UNITS, formatLength, type MeasureUnitId, type RulerGuide, type RulerMeasure } from "../../../../features/edit-construction/index.ts";
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

/** How the ruler is drawn for a table: the unit its teeth count in, the round number and the angle it offers. */
export interface RulerView {
  readonly unit: MeasureUnitId;
  /** The round number a length lands on, in metres; the teeth stand at every one. */
  readonly lengthStep?: number;
  /** The angular step the protractor offers, in radians; its larger marks stand at every one. */
  readonly angleStep?: number;
  /** Whether the protractor is drawn at all. */
  readonly protractor?: boolean;
}

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
    case "step":
      // A small x: a round number, nothing standing.
      segment(out, around(guide.at, -h / 2, -h / 2), around(guide.at, h / 2, h / 2));
      segment(out, around(guide.at, -h / 2, h / 2), around(guide.at, h / 2, -h / 2));
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

/** The spacings the teeth choose from, in the table's unit. */
const NICE_SPACINGS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
/** Teeth closer than this, on the screen, are a smear: the next spacing is taken. */
const TOOTH_MIN_PX = 10;
/** The most teeth drawn along one line. */
const MAX_TEETH = 200;

/**
 * The distance between the ruler's teeth, in metres: every round number the
 * table chose, else a round number of its unit as fine as the screen lets the
 * teeth be told apart -- finer as it is zoomed in, coarser as it is zoomed out.
 */
export function teethSpacing(metersPerPixel: number | undefined, unit: MeasureUnitId, lengthStep?: number): number {
  // A drawing never brings a gesture down: no unit named is the default one.
  const unitMeters = (MEASURE_UNITS[unit] ?? MEASURE_UNITS[DEFAULT_MEASURE_UNIT]).metres;
  const fits = (spacing: number): boolean => metersPerPixel === undefined || spacing / metersPerPixel >= TOOTH_MIN_PX;
  if (lengthStep && lengthStep > 0) {
    for (const k of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (fits(lengthStep * k)) return lengthStep * k;
    return lengthStep * 1000;
  }
  for (const n of NICE_SPACINGS) if (fits(n * unitMeters)) return n * unitMeters;
  return NICE_SPACINGS[NICE_SPACINGS.length - 1]! * unitMeters;
}

/** The ruler's teeth along the line from `from` to `to`: a tick at every `spacing`, longer at every fifth. */
function drawTeeth(out: number[], from: Point, to: Point, spacing: number, metersPerPixel: number | undefined): void {
  const dx = to.x - from.x, dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < spacing * 0.999 || !(spacing > 0)) return;
  const u = { x: dx / length, z: dz / length };
  const n = { x: -u.z, z: u.x };
  const minor = metersFor(metersPerPixel, 3, 0.1, [0.02, 0.4]);
  const count = Math.min(MAX_TEETH, Math.floor(length / spacing + 1e-9));
  for (let i = 1; i <= count; i += 1) {
    const reach = i % 5 === 0 ? minor * 2 : minor;
    const at = { x: from.x + u.x * spacing * i, y: from.y, z: from.z + u.z * spacing * i };
    segment(out, around(at, -n.x * reach, -n.z * reach), around(at, n.x * reach, n.z * reach));
  }
}

const DEGREE = Math.PI / 180;
/** The protractor's graduation, in degrees, and how far either side of the line it is drawn. */
const PROTRACTOR_GRADUATION = 5;
const PROTRACTOR_HALF_SPAN = 45;

/**
 * The protractor round where the line began: a mark every five degrees, from
 * `zero` -- the side the angles count from, or the world's axis -- longer at
 * every step the table chose, and longest at every quarter turn. Drawn only a
 * window either side of the line, so it reads and does not fill the screen.
 */
function drawProtractor(out: number[], origin: Point, to: Point, zero: number, angleStep: number | undefined, metersPerPixel: number | undefined): void {
  const length = Math.hypot(to.x - origin.x, to.z - origin.z);
  if (length < 0.3) return;
  const radius = Math.min(metersFor(metersPerPixel, 70, 0.8, [0.15, 6]), length * 0.9);
  const tick = (px: number): number => metersFor(metersPerPixel, px, 0.1, [0.02, 0.5]);
  const heading = Math.atan2(to.z - origin.z, to.x - origin.x);
  const relative = (heading - zero) / DEGREE;
  // A hair of slack, so a mark exactly at the window's edge is not lost to rounding.
  const first = Math.ceil((relative - PROTRACTOR_HALF_SPAN) / PROTRACTOR_GRADUATION - 1e-9);
  const last = Math.floor((relative + PROTRACTOR_HALF_SPAN) / PROTRACTOR_GRADUATION + 1e-9);
  const at = (degrees: number, r: number): Point => ({ x: origin.x + Math.cos(zero + degrees * DEGREE) * r, y: origin.y, z: origin.z + Math.sin(zero + degrees * DEGREE) * r });
  const stepDegrees = angleStep ? angleStep / DEGREE : undefined;
  for (let k = first; k <= last; k += 1) {
    const degrees = k * PROTRACTOR_GRADUATION;
    const quarter = Math.abs(degrees % 90) < 1e-9, eighth = Math.abs(degrees % 45) < 1e-9;
    const onStep = stepDegrees !== undefined && Math.abs(degrees / stepDegrees - Math.round(degrees / stepDegrees)) < 1e-9;
    const reach = tick(quarter ? 16 : eighth ? 13 : onStep ? 10 : 5);
    segment(out, at(degrees, radius), at(degrees, radius + reach));
    // The arc joins the marks.
    if (k < last) segment(out, at(degrees, radius), at(degrees + PROTRACTOR_GRADUATION, radius));
  }
  // Where the count starts from: the zero line.
  segment(out, origin, at(0, radius + tick(16)));
}

/** The guides, the teeth along the line being drawn, and the protractor round where it began, as one ghost; `undefined` when there is nothing to draw. */
export function rulerPreview(feedback: RulerFeedback, metersPerPixel?: number, view?: RulerView): PreviewDescriptor | undefined {
  const positions: number[] = [];
  const h = metersFor(metersPerPixel, MARKER_PX, MARKER_FALLBACK, [0.04, 0.6]);
  for (const guide of feedback.guides) drawGuide(positions, guide, h);
  let drawn: { from: Point; to: Point } | undefined;
  let reference: { run: readonly [Point, Point] } | undefined;
  for (const measure of feedback.measures) {
    if (measure.kind === "gap") segment(positions, measure.from, measure.to);
    // The side an angle is measured from is drawn, so what it is measured against is never a guess.
    else if (measure.kind === "angle" && measure.reference) { segment(positions, measure.reference.run[0], measure.reference.run[1]); reference = measure.reference; }
    else if (measure.kind === "length") drawn = { from: measure.from, to: measure.to };
  }
  if (view && drawn) {
    drawTeeth(positions, drawn.from, drawn.to, teethSpacing(metersPerPixel, view.unit, view.lengthStep), metersPerPixel);
    if (view.protractor) {
      const polar = feedback.guides.find((guide): guide is Extract<RulerGuide, { kind: "polar" }> => guide.kind === "polar");
      // The count starts from what caught, else from the side the angle is read against, else the world's axis.
      const zero = polar ? polar.zero : reference ? Math.atan2(reference.run[1].z - reference.run[0].z, reference.run[1].x - reference.run[0].x) : 0;
      drawProtractor(positions, drawn.from, drawn.to, zero, view.angleStep, metersPerPixel);
    }
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

/** What a guide is, in a word: what is catching -- and, for an angle, what it counts from. */
function guideLabel(guide: RulerGuide, unit: MeasureUnitId): string | undefined {
  switch (guide.kind) {
    case "point": return guide.role === "corner" ? "canto" : "meio da aresta";
    case "run": return "na aresta";
    case "square": return guide.relation === "perpendicular" ? "⊥ 90° da aresta" : "prolonga a aresta";
    case "align": return "alinhado";
    case "cross": return "interseção";
    case "length": return `= ${formatLength(guide.meters, unit)}`;
    case "step": return `${formatLength(guide.meters, unit)} fechado`;
    case "angle": return guide.relation === "parallel" ? "∥ paralelo" : "⊥ perpendicular";
    case "polar": return `${guide.degrees.toFixed(0)}° ${guide.from === "edge" ? "da aresta" : guide.from === "start" ? "do início" : "do mundo"}`;
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
