import { DEFAULT_MEASURE_UNIT, MEASURE_UNITS, NICE_STEPS, formatLength, type MeasureUnitId, type RulerGuide, type RulerMeasure } from "../../../../features/edit-construction/index.ts";
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
  /** Whether the numbers are written on the map (`ruler-labels.ts`); on unless said otherwise. */
  readonly numbers?: boolean;
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
 * triangle on the middle of a side, a diamond where two lines cross. Markers
 * only: every LINE the ruler draws goes through {@link drawLine}, one way.
 */
function drawMarker(out: number[], guide: RulerGuide, h: number): void {
  switch (guide.kind) {
    case "point":
      // A square on what can be joined (a corner, a road's node); a triangle on a place along something (a middle, a road's span).
      if (guide.role === "corner" || guide.role === "node") outline(out, guide.at, [[-h, -h], [h, -h], [h, h], [-h, h]]);
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
    case "level":
      segment(out, around({ ...guide.at, y: guide.y }, -h, 0), around({ ...guide.at, y: guide.y }, h, 0));
      return;
    default:
      return;
  }
}

/**
 * One line the ruler draws, whatever it is: a guide out of a corner, a side
 * it follows or is square to, the way to the nearest corner, the line being
 * drawn. It starts at `anchor` -- the item it comes out of -- and ends at `tip`.
 * Every one is drawn alike: the line, the ruler's teeth counted out from the
 * item, and -- where it comes out of an item -- the protractor round it.
 */
export interface RulerLine {
  readonly anchor: Point;
  readonly tip: Point;
  /** The direction the protractor counts from, in radians. */
  readonly zero: number;
  /** Whether the protractor is drawn round its anchor. */
  readonly protractor: boolean;
  /** Whether the line itself is drawn: not for the line being drawn, which is the tool's own ghost -- it only takes the teeth and the protractor. */
  readonly stroke: boolean;
}

const headingOf = (a: Point, b: Point): number => Math.atan2(b.z - a.z, b.x - a.x);
const sameLine = (a: RulerLine, b: RulerLine): boolean => {
  const near = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.z - q.z) < 1e-6;
  return (near(a.anchor, b.anchor) && near(a.tip, b.tip)) || (near(a.anchor, b.tip) && near(a.tip, b.anchor));
};

/** Every line `feedback` has to draw, in one list: guides and measures alike. */
export function linesOf(feedback: RulerFeedback): readonly RulerLine[] {
  const lines: RulerLine[] = [];
  const add = (line: RulerLine): void => { if (!lines.some((held) => sameLine(held, line))) lines.push(line); };
  const edge = (a: Point, b: Point): void => add({ anchor: a, tip: b, zero: headingOf(a, b), protractor: false, stroke: true });
  let reference: number | undefined;
  for (const measure of feedback.measures) {
    if (measure.kind === "angle" && measure.reference) reference = headingOf(measure.reference.run[0], measure.reference.run[1]);
  }
  const polar = feedback.guides.find((guide): guide is Extract<RulerGuide, { kind: "polar" }> => guide.kind === "polar");
  // The count starts from what caught, else from the side the angle is read against, else the world's axis.
  const zeroOfDrawn = polar ? polar.zero : reference ?? 0;
  for (const measure of feedback.measures) {
    if (measure.kind === "length") add({ anchor: measure.from, tip: measure.to, zero: zeroOfDrawn, protractor: true, stroke: false });
    // The way to the nearest corner comes out of the corner.
    else if (measure.kind === "gap") add({ anchor: measure.to, tip: measure.from, zero: reference ?? 0, protractor: true, stroke: true });
    // The side an angle is measured from is drawn, so what it is measured against is never a guess.
    else if (measure.kind === "angle" && measure.reference) edge(measure.reference.run[0], measure.reference.run[1]);
  }
  for (const guide of feedback.guides) {
    switch (guide.kind) {
      case "run": edge(guide.a, guide.b); break;
      case "length": edge(guide.run[0], guide.run[1]); break;
      case "align": add({ anchor: guide.from, tip: guide.to, zero: reference ?? 0, protractor: true, stroke: true }); break;
      case "square":
        edge(guide.run[0], guide.run[1]);
        add({ anchor: guide.from, tip: guide.to, zero: headingOf(guide.run[0], guide.run[1]), protractor: true, stroke: true });
        break;
      case "angle":
        edge(guide.run[0], guide.run[1]);
        add({ anchor: guide.origin, tip: guide.to, zero: headingOf(guide.run[0], guide.run[1]), protractor: false, stroke: true });
        break;
      case "polar": add({ anchor: guide.origin, tip: guide.to, zero: guide.zero, protractor: false, stroke: true }); break;
      default: break;
    }
  }
  return lines;
}

/** The spacings the teeth choose from, in the table's unit. */
const NICE_SPACINGS = NICE_STEPS;
/** Teeth closer than this, on the screen, are a smear: the next spacing is taken. */
const TOOTH_MIN_PX = 10;
/** The most teeth drawn along one line. */
export const MAX_TEETH = 200;

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

/** Where the protractor's marks stand, for one line: its radius, and the window of marks either side of the line. Shared by what draws it and what writes its numbers. */
export interface ProtractorGeometry {
  readonly origin: Point;
  readonly zero: number;
  readonly radius: number;
  /** The first and last mark of the window, in graduations from the zero. */
  readonly first: number;
  readonly last: number;
  /** Where the mark at `degrees` from the zero stands, at distance `r` from the origin. */
  readonly at: (degrees: number, r: number) => Point;
  /** How long a mark of `px` pixels is, in metres. */
  readonly tick: (px: number) => number;
}

/** The protractor round `origin` for the line to `to`; `undefined` when the line is too short to hold one. */
export function protractorOf(origin: Point, to: Point, zero: number, metersPerPixel: number | undefined): ProtractorGeometry | undefined {
  const length = Math.hypot(to.x - origin.x, to.z - origin.z);
  if (length < 0.3) return undefined;
  const radius = Math.min(metersFor(metersPerPixel, 70, 0.8, [0.15, 6]), length * 0.9);
  const heading = Math.atan2(to.z - origin.z, to.x - origin.x);
  const relative = (heading - zero) / DEGREE;
  return {
    origin, zero, radius,
    // A hair of slack, so a mark exactly at the window's edge is not lost to rounding.
    first: Math.ceil((relative - PROTRACTOR_HALF_SPAN) / PROTRACTOR_GRADUATION - 1e-9),
    last: Math.floor((relative + PROTRACTOR_HALF_SPAN) / PROTRACTOR_GRADUATION + 1e-9),
    at: (degrees, r) => ({ x: origin.x + Math.cos(zero + degrees * DEGREE) * r, y: origin.y, z: origin.z + Math.sin(zero + degrees * DEGREE) * r }),
    tick: (px) => metersFor(metersPerPixel, px, 0.1, [0.02, 0.5]),
  };
}

export const PROTRACTOR_STEP_DEGREES = PROTRACTOR_GRADUATION;

/**
 * The protractor round where the line began: a mark every five degrees, from
 * `zero` -- the side the angles count from, or the world's axis -- longer at
 * every step the table chose, and longest at every quarter turn. Drawn only a
 * window either side of the line, so it reads and does not fill the screen.
 */
function drawProtractor(out: number[], origin: Point, to: Point, zero: number, angleStep: number | undefined, metersPerPixel: number | undefined): void {
  const geometry = protractorOf(origin, to, zero, metersPerPixel);
  if (!geometry) return;
  const { radius, first, last, at, tick } = geometry;
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

/** The most protractors drawn round lines that come out of items, besides the line being drawn: more would be a clutter of arcs. */
export const MAX_ITEM_PROTRACTORS = 2;

/** One line, drawn one way: the line, the teeth out from its item, and the protractor when it comes out of one. */
function drawLine(out: number[], line: RulerLine, view: RulerView | undefined, metersPerPixel: number | undefined, protractor: boolean): void {
  if (line.stroke) segment(out, line.anchor, line.tip);
  if (!view) return;
  drawTeeth(out, line.anchor, line.tip, teethSpacing(metersPerPixel, view.unit, view.lengthStep), metersPerPixel);
  if (protractor && view.protractor) drawProtractor(out, line.anchor, line.tip, line.zero, view.angleStep, metersPerPixel);
}

/** What `feedback` draws, as one ghost: its markers, and every line -- guides, sides, the way to a corner, the line being drawn -- alike, with the ruler's teeth and protractor. `undefined` when there is nothing. */
export function rulerPreview(feedback: RulerFeedback, metersPerPixel?: number, view?: RulerView): PreviewDescriptor | undefined {
  const positions: number[] = [];
  const h = metersFor(metersPerPixel, MARKER_PX, MARKER_FALLBACK, [0.04, 0.6]);
  for (const guide of feedback.guides) drawMarker(positions, guide, h);
  let itemProtractors = 0;
  for (const line of linesOf(feedback)) {
    // The line being drawn always has its protractor; a line out of an item, only the first few.
    const wanted = line.protractor && (!line.stroke || itemProtractors++ < MAX_ITEM_PROTRACTORS);
    drawLine(positions, line, view, metersPerPixel, wanted);
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
    case "point": return guide.role === "corner" ? "canto" : guide.role === "node" ? "nó da rua" : guide.role === "span" ? "sobre a rua" : "meio da aresta";
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
