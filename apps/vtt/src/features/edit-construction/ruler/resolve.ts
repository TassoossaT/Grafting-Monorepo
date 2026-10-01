import type { ConstructionPosition } from "@/ports";

import { nearestOnSegment } from "../topology/plan-geometry.ts";
import type { LinkPoint, LinkRun, RulerLinks } from "./links.ts";

/**
 * The one place a point is joined to, lined up with or measured against what
 * stands. Every tool and every handle asks this and applies the answer; none
 * re-derives a link. The answer carries what to draw -- guides and measures --
 * whether or not the position is taken, so the ruler shows while the snap is
 * only an option.
 */

/** How close, in plan, a point must come to a link for it to catch. */
export const RULER_REACH = 0.2;
/** How close, in height, a level must come to catch. */
export const LEVEL_REACH = 0.15;
/** How far a gap is measured to the nearest link. */
const MEASURE_REACH = 4;
/** How near a straight line a position must be for a drag along it to count as on it. */
const ON_PATH = 1e-3;

export interface PlanVector {
  readonly x: number;
  readonly z: number;
}

/** What moves the point: anywhere on the ground, or only along `direction` (unit length). */
export type RulerMotion = { readonly kind: "free" } | { readonly kind: "line"; readonly direction: PlanVector };

export interface RulerQuery {
  /** Where the point would stand with no ruler. */
  readonly point: ConstructionPosition;
  readonly links: RulerLinks;
  readonly motion?: RulerMotion;
  /** Where what is being drawn began: its length is measured from here, and may match a standing run's. */
  readonly origin?: ConstructionPosition;
  /** The two directions lines are lined up along -- a build frame's, else the world's. Unit length, square to each other. */
  readonly axes?: readonly [PlanVector, PlanVector];
  /** Links by node id the point never joins -- itself, where it began. */
  readonly skip?: ReadonlySet<string>;
  /** Refuses a snap onto a run the caller knows would not hold. Gets where the point would land. */
  readonly accept?: (landing: ConstructionPosition, run: LinkRun) => boolean;
  /** Whether the answer is taken. Off, the position stays and the guides still say what was near. */
  readonly snap?: boolean;
  readonly reach?: number;
}

export type RulerGuide =
  /** Onto a corner. */
  | { readonly kind: "point"; readonly at: ConstructionPosition; readonly node: string }
  /** Onto a side. */
  | { readonly kind: "run"; readonly a: ConstructionPosition; readonly b: ConstructionPosition; readonly at: ConstructionPosition }
  /** In line with a corner, along one of the axes. */
  | { readonly kind: "align"; readonly from: ConstructionPosition; readonly to: ConstructionPosition; readonly node: string }
  /** As long as a standing side. */
  | { readonly kind: "length"; readonly run: readonly [ConstructionPosition, ConstructionPosition]; readonly meters: number }
  /** Running the same way as a standing side, or square to it. */
  | { readonly kind: "angle"; readonly origin: ConstructionPosition; readonly to: ConstructionPosition; readonly run: readonly [ConstructionPosition, ConstructionPosition]; readonly relation: "parallel" | "perpendicular" }
  /** At the height of a standing level. */
  | { readonly kind: "level"; readonly y: number; readonly at: ConstructionPosition };

/**
 * Something worth saying about what is built or edited. Distances are always
 * in metres -- `formatLength` writes them in the table's unit.
 */
export type RulerMeasure =
  /** `"length"` is what is being drawn; `"gap"` is the way to the nearest corner. */
  | { readonly kind: "length" | "gap"; readonly from: ConstructionPosition; readonly to: ConstructionPosition; readonly meters: number }
  /** How high what is being edited stands: above its own base, and at what level of the table. */
  | { readonly kind: "height"; readonly meters: number; readonly level: number }
  /** How big something is now -- a road's width, say; `name` says what. */
  | { readonly kind: "size"; readonly name: string; readonly meters: number }
  /** How much an edit changes a size or a distance, with its sign; `name` says which. */
  | { readonly kind: "change"; readonly name: string; readonly meters: number }
  /** An angle, in degrees: how far a line runs from the nearest standing side's direction, or a turn. `name` says which. */
  | { readonly kind: "angle"; readonly degrees: number; readonly name?: string };

export interface RulerResult {
  /** Where the point stands: snapped when `snap` was asked for and something caught, else as it came. */
  readonly position: ConstructionPosition;
  /** What caught, whether or not it was taken. */
  readonly caught: "point" | "run" | "align" | "angle" | "length" | undefined;
  readonly guides: readonly RulerGuide[];
  readonly measures: readonly RulerMeasure[];
}

interface Fix {
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly guides: readonly RulerGuide[];
}

const WORLD_AXES: readonly [PlanVector, PlanVector] = [{ x: 1, z: 0 }, { x: 0, z: 1 }];

const nearer = (best: Fix | undefined, fix: Fix | undefined): Fix | undefined => (fix && (!best || fix.distance < best.distance) ? fix : best);

/** The fix moving `fix` along `direction` only; `undefined` when it lies off the path. */
function alongPath(fix: PlanVector, direction: PlanVector | undefined): PlanVector | undefined {
  if (!direction) return fix;
  const along = fix.x * direction.x + fix.z * direction.z;
  if (Math.hypot(fix.x - direction.x * along, fix.z - direction.z * along) > ON_PATH) return undefined;
  return { x: direction.x * along, z: direction.z * along };
}

function cornerFix(query: RulerQuery, p: ConstructionPosition, reach: number): Fix | undefined {
  const direction = query.motion?.kind === "line" ? query.motion.direction : undefined;
  let best: Fix | undefined;
  for (const link of query.links.points) {
    if (query.skip?.has(link.id) || Math.abs(link.position.y - p.y) > LEVEL_REACH) continue;
    const fix = alongPath({ x: link.position.x - p.x, z: link.position.z - p.z }, direction);
    if (!fix) continue;
    const distance = Math.hypot(fix.x, fix.z);
    if (distance <= reach) best = nearer(best, { ...fix, distance, guides: [{ kind: "point", at: link.position, node: link.id }] });
  }
  return best;
}

function sideFix(query: RulerQuery, p: ConstructionPosition, reach: number): Fix | undefined {
  const direction = query.motion?.kind === "line" ? query.motion.direction : undefined;
  let best: Fix | undefined;
  for (const run of query.links.runs) {
    if (Math.abs(run.a.position.y - p.y) > LEVEL_REACH) continue;
    const a = run.a.position, b = run.b.position;
    let fix: PlanVector;
    if (direction) {
      // Onto the run's line along the path -- where the path meets it.
      const ex = b.x - a.x, ez = b.z - a.z;
      const cross = direction.x * ez - direction.z * ex;
      if (Math.abs(cross) < 1e-9) continue;
      const s = ((a.x - p.x) * ez - (a.z - p.z) * ex) / cross;
      fix = { x: direction.x * s, z: direction.z * s };
    } else {
      const q = nearestOnSegment(p, a, b);
      fix = { x: q.x - p.x, z: q.z - p.z };
    }
    const distance = Math.hypot(fix.x, fix.z);
    if (distance > reach) continue;
    const landing = { x: p.x + fix.x, y: p.y, z: p.z + fix.z };
    if (query.accept && !query.accept(landing, run)) continue;
    best = nearer(best, { ...fix, distance, guides: [{ kind: "run", a, b, at: landing }] });
  }
  return best;
}

/** In line with a corner along an axis; a free point takes one of each axis at once, and so lands on their crossing. */
function alignFix(query: RulerQuery, p: ConstructionPosition, reach: number): Fix | undefined {
  const axes = query.axes ?? WORLD_AXES;
  const direction = query.motion?.kind === "line" ? query.motion.direction : undefined;
  const perAxis: (Fix | undefined)[] = [undefined, undefined];
  axes.forEach((axis, i) => {
    // The line through a corner along `axis`: the point is on it when its offset along the axis' normal is nil.
    const normal = { x: -axis.z, z: axis.x };
    for (const link of query.links.points) {
      if (query.skip?.has(link.id) || Math.abs(link.position.y - p.y) > LEVEL_REACH) continue;
      const offset = (p.x - link.position.x) * normal.x + (p.z - link.position.z) * normal.z;
      let fix: PlanVector;
      if (direction) {
        const rate = direction.x * normal.x + direction.z * normal.z;
        if (Math.abs(rate) < 1e-6) continue;
        const s = -offset / rate;
        fix = { x: direction.x * s, z: direction.z * s };
      } else fix = { x: -normal.x * offset, z: -normal.z * offset };
      const distance = Math.hypot(fix.x, fix.z);
      if (distance > reach) continue;
      perAxis[i] = nearer(perAxis[i], { ...fix, distance, guides: [{ kind: "align", from: link.position, to: { x: p.x + fix.x, y: p.y, z: p.z + fix.z }, node: link.id }] });
    }
  });
  const [first, second] = perAxis;
  if (first && second && !direction) {
    return { x: first.x + second.x, z: first.z + second.z, distance: Math.hypot(first.x + second.x, first.z + second.z), guides: [...first.guides, ...second.guides] };
  }
  return nearer(first, second);
}

/** As long as a standing run, measured from where the drawing began. */
function lengthFix(query: RulerQuery, p: ConstructionPosition, reach: number): Fix | undefined {
  const origin = query.origin;
  if (!origin) return undefined;
  const dx = p.x - origin.x, dz = p.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return undefined;
  const u = { x: dx / length, z: dz / length };
  const direction = query.motion?.kind === "line" ? query.motion.direction : undefined;
  if (direction && Math.abs(u.x * direction.z - u.z * direction.x) > ON_PATH) return undefined;
  let best: Fix | undefined;
  for (const run of query.links.runs) {
    const standing = Math.hypot(run.b.position.x - run.a.position.x, run.b.position.z - run.a.position.z);
    const gap = standing - length;
    if (Math.abs(gap) > reach) continue;
    best = nearer(best, { x: u.x * gap, z: u.z * gap, distance: Math.abs(gap), guides: [{ kind: "length", run: [run.a.position, run.b.position], meters: standing }] });
  }
  return best;
}

/** How far from a standing side's direction, or square to it, a line may run and still be taken as running that way. */
const ANGLE_REACH = (3 * Math.PI) / 180;
/** How far from where a line begins a standing side may lie and still be one to follow. */
const ANGLE_RANGE = 12;
const QUARTER_TURN = Math.PI / 2;

interface Heading {
  /** How far the line runs from the side's direction -- or from square to it -- in radians, within a quarter turn either way. */
  readonly deviation: number;
  readonly relation: "parallel" | "perpendicular";
  readonly run: LinkRun;
}

/** The standing side, near `origin`, whose direction -- or the square to it -- the line at `heading` runs closest to. */
function nearestHeading(query: RulerQuery, origin: ConstructionPosition, heading: number): Heading | undefined {
  let best: Heading | undefined;
  for (const run of query.links.runs) {
    if (nearestOnSegment(origin, run.a.position, run.b.position).distance > ANGLE_RANGE) continue;
    const away = heading - Math.atan2(run.b.position.z - run.a.position.z, run.b.position.x - run.a.position.x);
    const turns = Math.round(away / QUARTER_TURN);
    const deviation = away - turns * QUARTER_TURN;
    const relation = Math.abs(turns) % 2 === 0 ? "parallel" : "perpendicular";
    const better = !best || Math.abs(deviation) < Math.abs(best.deviation) - 1e-9
      // A tie -- a square corner offers both -- names the side it runs along, not the one square to it.
      || (Math.abs(Math.abs(deviation) - Math.abs(best.deviation)) <= 1e-9 && relation === "parallel" && best.relation === "perpendicular");
    if (better) best = { deviation, relation, run };
  }
  return best;
}

/** The line from where the drawing began, turned about that point onto a standing side's direction -- or square to it -- keeping its length. */
function angleFix(query: RulerQuery, p: ConstructionPosition): Fix | undefined {
  const origin = query.origin;
  if (!origin || query.motion?.kind === "line") return undefined;
  const dx = p.x - origin.x, dz = p.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return undefined;
  const found = nearestHeading(query, origin, Math.atan2(dz, dx));
  if (!found || Math.abs(found.deviation) > ANGLE_REACH) return undefined;
  const target = Math.atan2(dz, dx) - found.deviation;
  const to = { x: origin.x + Math.cos(target) * length, y: p.y, z: origin.z + Math.sin(target) * length };
  const fix = { x: to.x - p.x, z: to.z - p.z };
  return { ...fix, distance: Math.hypot(fix.x, fix.z), guides: [{ kind: "angle", origin, to, run: [found.run.a.position, found.run.b.position], relation: found.relation }] };
}

/** What the ruler says of a point on the ground: where it lands, what to draw and what to measure. */
export function resolveRuler(query: RulerQuery): RulerResult {
  const reach = query.reach ?? RULER_REACH;
  const p = query.point;
  // A corner beats a side, a side beats a line-up, a line-up beats a direction, a direction beats a matched length.
  const picks: readonly (readonly [RulerResult["caught"], Fix | undefined])[] = [
    ["point", cornerFix(query, p, reach)],
    ["run", sideFix(query, p, reach)],
    ["align", alignFix(query, p, reach)],
    ["angle", angleFix(query, p)],
    ["length", lengthFix(query, p, reach)],
  ];
  const [caught, first] = picks.find(([, candidate]) => candidate) ?? [undefined, undefined];
  let fix = first;
  // A line turned onto a direction can still be as long as a standing side: both hold at once.
  if (caught === "angle" && fix) {
    const turned = { x: p.x + fix.x, y: p.y, z: p.z + fix.z };
    const matched = lengthFix(query, turned, reach);
    if (matched) fix = { x: fix.x + matched.x, z: fix.z + matched.z, distance: fix.distance + matched.distance, guides: [...fix.guides, ...matched.guides] };
  }
  const position = fix && query.snap !== false ? { x: p.x + fix.x, y: p.y, z: p.z + fix.z } : p;
  return { position, caught: fix ? caught : undefined, guides: fix?.guides ?? [], measures: measuresAt(query, position) };
}

/** What is being drawn, and the way from the point to the nearest corner it is not on. */
function measuresAt(query: RulerQuery, position: ConstructionPosition): readonly RulerMeasure[] {
  const measures: RulerMeasure[] = [];
  if (query.origin) {
    const meters = Math.hypot(position.x - query.origin.x, position.z - query.origin.z);
    if (meters > 1e-6) {
      measures.push({ kind: "length", from: query.origin, to: position, meters });
      // Which way it runs, against the nearest standing side: 0 is the same way, or square to it.
      const heading = nearestHeading(query, query.origin, Math.atan2(position.z - query.origin.z, position.x - query.origin.x));
      if (heading) measures.push({ kind: "angle", degrees: (heading.deviation * 180) / Math.PI });
    }
  }
  let nearest: { link: LinkPoint; meters: number } | undefined;
  for (const link of query.links.points) {
    if (query.skip?.has(link.id)) continue;
    const meters = Math.hypot(link.position.x - position.x, link.position.z - position.z);
    if (meters > 1e-6 && meters <= MEASURE_REACH && (!nearest || meters < nearest.meters)) nearest = { link, meters };
  }
  if (nearest) measures.push({ kind: "gap", from: position, to: nearest.link.position, meters: nearest.meters });
  return measures;
}

/** `y` landed on the nearest standing level within reach, when the snap is on; else as it came. */
export function resolveLevel(y: number, links: RulerLinks, at: ConstructionPosition, options: { readonly snap?: boolean; readonly reach?: number } = {}): { readonly y: number; readonly guide?: RulerGuide } {
  const reach = options.reach ?? LEVEL_REACH;
  let best: number | undefined;
  for (const level of links.levels) if (Math.abs(level - y) <= reach && (best === undefined || Math.abs(level - y) < Math.abs(best - y))) best = level;
  if (best === undefined) return { y };
  return { y: options.snap === false ? y : best, guide: { kind: "level", y: best, at } };
}
