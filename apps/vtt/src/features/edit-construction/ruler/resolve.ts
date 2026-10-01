import type { ConstructionPosition } from "@/ports";

import { nearestOnSegment } from "../topology/plan-geometry.ts";
import type { LinkPoint, LinkRun, RulerLinks } from "./links.ts";
import { ROUND_REACH_SHARE } from "./steps.ts";

/**
 * The one place a point is joined to, lined up with or measured against what
 * stands. Every tool and every handle asks this and applies the answer; none
 * re-derives a link. The answer carries what to draw -- guides and measures --
 * whether or not the position is taken, so the ruler shows while the snap is
 * only an option.
 */

/** How close, in plan, a point must come to a link for it to catch -- when the caller knows no better, in metres. */
export const RULER_REACH = 0.2;
/** How close, in height, a level must come to catch. */
export const LEVEL_REACH = 0.15;
/** A catch already held stays until the point is this many times further than the reach: no flicker at the edge. */
export const HOLD_FACTOR = 1.6;
/** How far a gap is measured to the nearest link. */
const MEASURE_REACH = 4;
/** How near a straight line a position must be for a drag along it to count as on it. */
const ON_PATH = 1e-3;

/** Every way the ruler can catch, so a table can say which it wants. */
export const RULER_KINDS = ["corner", "midpoint", "side", "square", "align", "intersection", "angle", "polar", "length", "level"] as const;
export type RulerKind = (typeof RULER_KINDS)[number];

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
  /** How close a link must come to catch, in metres. The caller works it out from the screen, so the feel does not change with the zoom. */
  readonly reach?: number;
  /** How far from the point a link may stand and still offer its lines: what is not near is not acquired, so a full map does not draw a lattice. */
  readonly acquire?: number;
  /** The catch held last time -- its {@link RulerResult.key} -- which stays on past the reach, up to {@link HOLD_FACTOR} times it. */
  readonly holding?: string;
  /** Steps of the protractor from `origin`, in radians; none when absent. They count from the nearest standing side, or the world's x axis when none is near. */
  readonly polar?: number;
  /** The round number, in metres, a length from `origin` lands on when near one: 1 for whole metres. None when absent. */
  readonly lengthStep?: number;
  /** How near a round number a length must come to land on it, in metres: stronger than the reach of a join. Held to a share of the step, so a length between two round numbers stays free. */
  readonly stepReach?: number;
  /** Ways of catching left out. */
  readonly disabled?: ReadonlySet<RulerKind>;
}

export type RulerGuide =
  /** Onto a corner, or the middle of a side. */
  | { readonly kind: "point"; readonly at: ConstructionPosition; readonly node: string; readonly role: "corner" | "midpoint" | "node" | "span" }
  /** Onto a side. */
  | { readonly kind: "run"; readonly a: ConstructionPosition; readonly b: ConstructionPosition; readonly at: ConstructionPosition }
  /** Square to a standing side at one of its ends -- 90 degrees off it -- or in line with it, beyond its end. */
  | { readonly kind: "square"; readonly run: readonly [ConstructionPosition, ConstructionPosition]; readonly from: ConstructionPosition; readonly to: ConstructionPosition; readonly relation: "perpendicular" | "collinear" }
  /** In line with a corner or a middle, along one of the axes. */
  | { readonly kind: "align"; readonly from: ConstructionPosition; readonly to: ConstructionPosition; readonly node: string }
  /** Where two of those lines cross. */
  | { readonly kind: "cross"; readonly at: ConstructionPosition }
  /** As long as a standing side. */
  | { readonly kind: "length"; readonly run: readonly [ConstructionPosition, ConstructionPosition]; readonly meters: number }
  /** Running the same way as a standing side, or square to it. */
  | { readonly kind: "angle"; readonly origin: ConstructionPosition; readonly to: ConstructionPosition; readonly run: readonly [ConstructionPosition, ConstructionPosition]; readonly relation: "parallel" | "perpendicular" }
  /** On one of the protractor's steps from where the line began; `degrees` is the heading from the nearest side, or from the world's x axis when none is near. */
  | { readonly kind: "polar"; readonly origin: ConstructionPosition; readonly to: ConstructionPosition; readonly degrees: number; readonly from: "edge" | "world" | "start"; /** The direction the count starts from, in radians: where the protractor's zero stands. */ readonly zero: number }
  /** As long as a round number: `meters` is that number, and the line ends at `at`. */
  | { readonly kind: "step"; readonly at: ConstructionPosition; readonly meters: number }
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
  | { readonly kind: "height"; readonly meters: number; readonly level: number; /** Where it rises from, under it, and where it stands: the ruler is drawn between them, upright. */ readonly foot?: ConstructionPosition; readonly top?: ConstructionPosition }
  /** How steeply a run climbs: `rise` over `run`, both in metres and signed by the way it goes. */
  | { readonly kind: "grade"; readonly rise: number; readonly run: number }
  /** How big something is now -- a road's width, say; `name` says what. */
  | { readonly kind: "size"; readonly name: string; readonly meters: number; /** Where it runs from and to: the ruler is drawn along it, with its teeth and its value. */ readonly from?: ConstructionPosition; readonly to?: ConstructionPosition }
  /** What a size or a distance was before the edit and is now: the difference from where the edit began. */
  | { readonly kind: "was"; readonly name: string; readonly was: number; readonly now: number; /** The values are headings in degrees, not lengths. */ readonly degrees?: boolean }
  /** How much an edit changes a size or a distance, with its sign; `name` says which. */
  | { readonly kind: "change"; readonly name: string; readonly meters: number; /** Where the edit began and where it stands: the difference is drawn between them. */ readonly from?: ConstructionPosition; readonly to?: ConstructionPosition; /** Whether the line carries the protractor round where it began: a move across the ground reads by the way it went. */ readonly arc?: boolean }
  /** An angle, in degrees: how far a line runs from the nearest standing side's direction, or a turn. `name` says which. */
  | { readonly kind: "angle"; readonly degrees: number; readonly name?: string; readonly reference?: { readonly run: readonly [ConstructionPosition, ConstructionPosition]; readonly relation: "parallel" | "perpendicular" } };

export interface RulerResult {
  /** Where the point stands: snapped when `snap` was asked for and something caught, else as it came. */
  readonly position: ConstructionPosition;
  /** What caught, whether or not it was taken. */
  readonly caught: "point" | "run" | "intersection" | "square" | "align" | "angle" | "polar" | "length" | "step" | undefined;
  /** Names the catch, to be handed back as {@link RulerQuery.holding} on the next question. */
  readonly key: string | undefined;
  readonly guides: readonly RulerGuide[];
  readonly measures: readonly RulerMeasure[];
}

interface Fix {
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly guides: readonly RulerGuide[];
  readonly key: string;
}

/** The reach, and who is allowed past it: only the catch being held. */
interface Reach {
  readonly reach: number;
  /** Whether a catch `distance` away, named `key`, is close enough. */
  within(distance: number, key: string): boolean;
  /** The reach `key` gets: wider while it is the one held. */
  of(key: string): number;
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

const on = (query: RulerQuery, kind: RulerKind): boolean => !query.disabled?.has(kind);
const pathOf = (query: RulerQuery): PlanVector | undefined => (query.motion?.kind === "line" ? query.motion.direction : undefined);
const runKeyOf = (run: LinkRun): string => (run.a.id < run.b.id ? `${run.a.id}|${run.b.id}` : `${run.b.id}|${run.a.id}`);

/** Onto a corner -- a node to join -- or the middle of a side. A corner beats a middle when both are as near. */
function cornerFix(query: RulerQuery, p: ConstructionPosition, rc: Reach): Fix | undefined {
  const direction = pathOf(query);
  let best: Fix | undefined;
  const consider = (link: LinkPoint, role: "corner" | "midpoint"): void => {
    if (query.skip?.has(link.id) || Math.abs(link.position.y - p.y) > LEVEL_REACH) return;
    const fix = alongPath({ x: link.position.x - p.x, z: link.position.z - p.z }, direction);
    if (!fix) return;
    const distance = Math.hypot(fix.x, fix.z);
    const key = `${role}:${link.id}`;
    // A middle yields to a corner at the same distance: a corner is a node, a middle only a place.
    if (rc.within(distance, key)) best = nearer(best, { ...fix, distance: distance + (role === "midpoint" ? 1e-9 : 0), guides: [{ kind: "point", at: link.position, node: link.id, role }], key });
  };
  if (on(query, "corner")) for (const link of query.links.points) consider(link, "corner");
  if (on(query, "midpoint")) for (const link of query.links.midpoints ?? []) consider(link, "midpoint");
  return best;
}

function sideFix(query: RulerQuery, p: ConstructionPosition, rc: Reach): Fix | undefined {
  if (!on(query, "side")) return undefined;
  const direction = pathOf(query);
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
    const key = `side:${runKeyOf(run)}`;
    if (!rc.within(distance, key)) continue;
    const landing = { x: p.x + fix.x, y: p.y, z: p.z + fix.z };
    if (query.accept && !query.accept(landing, run)) continue;
    best = nearer(best, { ...fix, distance, guides: [{ kind: "run", a, b, at: landing }], key });
  }
  return best;
}

/** One straight line the point may be on: through `origin`, running along `dir` (unit length). */
interface Line {
  readonly origin: ConstructionPosition;
  readonly dir: PlanVector;
  readonly kind: "square" | "align";
  readonly key: string;
  /** Standing `landed`, the guide that draws this line. */
  readonly guide: (landed: ConstructionPosition) => RulerGuide;
}

/**
 * Every line near `p` the point can be on. Each corner and middle offers one
 * along each of the axes; each side, at each end, offers the one square to it
 * and the one running on from it. What is further than `acquire` is not
 * offered: a map full of structures would otherwise be one lattice of guides.
 */
function linesNear(query: RulerQuery, p: ConstructionPosition): readonly Line[] {
  const lines: Line[] = [];
  const acquire = query.acquire ?? Infinity;
  const axes = query.axes ?? WORLD_AXES;
  const near = (link: LinkPoint): boolean => !query.skip?.has(link.id) && Math.abs(link.position.y - p.y) <= LEVEL_REACH && Math.hypot(link.position.x - p.x, link.position.z - p.z) <= acquire;
  const anchors: { readonly link: LinkPoint; readonly role: "corner" | "midpoint" }[] = [];
  if (on(query, "align")) {
    for (const link of query.links.points) if (near(link)) anchors.push({ link, role: "corner" });
    for (const link of query.links.midpoints ?? []) if (near(link)) anchors.push({ link, role: "midpoint" });
  }
  for (const { link } of anchors) {
    axes.forEach((axis, index) => lines.push({
      origin: link.position, dir: axis, kind: "align", key: `align:${link.id}:${index}`,
      guide: (landed) => ({ kind: "align", from: link.position, to: landed, node: link.id }),
    }));
  }
  if (on(query, "square")) {
    for (const run of query.links.runs) {
      const a = run.a.position, b = run.b.position;
      if (Math.abs(a.y - p.y) > LEVEL_REACH || nearestOnSegment(p, a, b).distance > acquire) continue;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const d = { x: (b.x - a.x) / length, z: (b.z - a.z) / length };
      const normal = { x: -d.z, z: d.x };
      for (const end of [run.a, run.b]) {
        if (query.skip?.has(end.id)) continue;
        for (const [dir, relation] of [[normal, "perpendicular"], [d, "collinear"]] as const) {
          lines.push({
            origin: end.position, dir, kind: "square", key: `square:${runKeyOf(run)}:${end.id}:${relation}`,
            guide: (landed) => ({ kind: "square", run: [a, b], from: end.position, to: landed, relation }),
          });
        }
      }
    }
  }
  return lines;
}

/** The same line is the same wherever its guide starts: two corners on one axis line offer it once. */
function lineIdentity(line: Line): string {
  const n = { x: -line.dir.z, z: line.dir.x };
  const flip = n.x < -1e-9 || (Math.abs(n.x) <= 1e-9 && n.z < 0) ? -1 : 1;
  const angle = Math.round(Math.atan2(n.z * flip, n.x * flip) * 1e4);
  const offset = Math.round(((line.origin.x * n.x + line.origin.z * n.z) * flip) * 1e3);
  return `${angle}:${offset}`;
}

interface Candidate extends Fix {
  readonly line: Line;
}

/**
 * On a line, or where two lines cross: lines are caught one at a time, and
 * two that are not parallel and both near land on their crossing -- a point
 * that is square to this edge and in line with that corner. A crossing beats
 * a line; a side's square or run-on beats an axis.
 */
function lineFix(query: RulerQuery, p: ConstructionPosition, rc: Reach): { readonly fix: Fix; readonly caught: "intersection" | "square" | "align" } | undefined {
  const direction = pathOf(query);
  const seen = new Map<string, Candidate>();
  for (const line of linesNear(query, p)) {
    const n = { x: -line.dir.z, z: line.dir.x };
    const offset = (p.x - line.origin.x) * n.x + (p.z - line.origin.z) * n.z;
    let fix: PlanVector;
    if (direction) {
      const rate = direction.x * n.x + direction.z * n.z;
      if (Math.abs(rate) < 1e-6) continue;
      const s = -offset / rate;
      fix = { x: direction.x * s, z: direction.z * s };
    } else fix = { x: -n.x * offset, z: -n.z * offset };
    const distance = Math.hypot(fix.x, fix.z);
    if (!rc.within(distance, line.key)) continue;
    const landed = { x: p.x + fix.x, y: p.y, z: p.z + fix.z };
    // A side's lines win a tie against an axis through a corner.
    const candidate: Candidate = { ...fix, distance: distance + (line.kind === "square" ? 0 : 1e-9), guides: [line.guide(landed)], key: line.key, line };
    const identity = lineIdentity(line);
    const held = seen.get(identity);
    if (!held || candidate.distance < held.distance) seen.set(identity, candidate);
  }
  const candidates = [...seen.values()].sort((a, b) => a.distance - b.distance);
  if (candidates.length === 0) return undefined;

  if (!direction && on(query, "intersection")) {
    let crossing: { fix: Fix } | undefined;
    const pool = candidates.slice(0, 8);
    for (let i = 0; i < pool.length; i += 1) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const a = pool[i]!.line, b = pool[j]!.line;
        const det = a.dir.x * b.dir.z - a.dir.z * b.dir.x;
        // Nearly parallel lines cross far away, and by no steady reading.
        if (Math.abs(det) < 0.3) continue;
        const t = ((b.origin.x - a.origin.x) * b.dir.z - (b.origin.z - a.origin.z) * b.dir.x) / det;
        const at = { x: a.origin.x + a.dir.x * t, y: p.y, z: a.origin.z + a.dir.z * t };
        const fix = { x: at.x - p.x, z: at.z - p.z };
        const distance = Math.hypot(fix.x, fix.z);
        const key = `cross:${pool[i]!.key}|${pool[j]!.key}`;
        if (distance > rc.of(key) * HOLD_FACTOR || (crossing && distance >= crossing.fix.distance)) continue;
        crossing = { fix: { ...fix, distance, key, guides: [a.guide(at), b.guide(at), { kind: "cross", at }] } };
      }
    }
    if (crossing) return { fix: crossing.fix, caught: "intersection" };
  }
  const best = candidates[0]!;
  return { fix: best, caught: best.line.kind };
}

/** As long as a standing run, measured from where the drawing began. */
function lengthFix(query: RulerQuery, p: ConstructionPosition, rc: Reach): Fix | undefined {
  const origin = query.origin;
  if (!origin || !on(query, "length")) return undefined;
  const dx = p.x - origin.x, dz = p.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return undefined;
  const u = { x: dx / length, z: dz / length };
  const direction = pathOf(query);
  if (direction && Math.abs(u.x * direction.z - u.z * direction.x) > ON_PATH) return undefined;
  let best: Fix | undefined;
  for (const run of query.links.runs) {
    const standing = Math.hypot(run.b.position.x - run.a.position.x, run.b.position.z - run.a.position.z);
    const gap = standing - length;
    const key = `length:${runKeyOf(run)}`;
    if (!rc.within(Math.abs(gap), key)) continue;
    best = nearer(best, { x: u.x * gap, z: u.z * gap, distance: Math.abs(gap), guides: [{ kind: "length", run: [run.a.position, run.b.position], meters: standing }], key });
  }
  // A round number, when no side's length is as near: whole metres, or whatever step the table chose.
  const step = query.lengthStep;
  if (step && step > 0) {
    const turns = Math.round(length / step);
    const gap = turns * step - length;
    const key = `step:${turns}`;
    // Stronger than a join's reach, yet never more than a share of the step: what lies between two round numbers is left free.
    const reach = Math.min(query.stepReach ?? rc.reach * 1.7, step * ROUND_REACH_SHARE);
    if (turns >= 1 && Math.abs(gap) <= (query.holding === key ? reach * HOLD_FACTOR : reach)) {
      const at = { x: origin.x + u.x * turns * step, y: p.y, z: origin.z + u.z * turns * step };
      // A side's length wins a tie: it is something standing; a round number is only a convenience.
      best = nearer(best, { x: u.x * gap, z: u.z * gap, distance: Math.abs(gap) + 1e-9, guides: [{ kind: "step", at, meters: turns * step }], key });
    }
  }
  return best;
}

const DEGREE = Math.PI / 180;
/** The widest a line may run from a direction and still be taken as running that way. */
const ANGLE_REACH = 5 * DEGREE;
/** The narrowest: however long the line, a catch is never finer than this. */
const ANGLE_FLOOR = 2.5 * DEGREE;
/** An angle's reach is a longer one than a point's, seen from the line's end: a direction is easy to miss by a hair and hard to put right by hand. */
const ANGLE_PIXEL_FACTOR = 1.6;

/**
 * How far, in radians, a line of `length` may run from a direction and still be
 * on it: the same few pixels of the screen as every other catch, seen from the
 * line's own end -- so a long line is held to a finer angle than a short one --
 * kept within `cap`, and never finer than {@link ANGLE_FLOOR}.
 */
function angularReach(reach: number, length: number, cap: number): number {
  return Math.max(Math.min(ANGLE_FLOOR, cap), Math.min(cap, Math.atan2(reach * ANGLE_PIXEL_FACTOR, length)));
}
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
function angleFix(query: RulerQuery, p: ConstructionPosition, rc: Reach): Fix | undefined {
  const origin = query.origin;
  if (!origin || query.motion?.kind === "line" || !on(query, "angle")) return undefined;
  const dx = p.x - origin.x, dz = p.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return undefined;
  const found = nearestHeading(query, origin, Math.atan2(dz, dx));
  if (!found) return undefined;
  const key = `angle:${runKeyOf(found.run)}:${found.relation}`;
  if (Math.abs(found.deviation) > angularReach(rc.of(key), length, ANGLE_REACH)) return undefined;
  const target = Math.atan2(dz, dx) - found.deviation;
  const to = { x: origin.x + Math.cos(target) * length, y: p.y, z: origin.z + Math.sin(target) * length };
  const fix = { x: to.x - p.x, z: to.z - p.z };
  return { ...fix, distance: Math.hypot(fix.x, fix.z), guides: [{ kind: "angle", origin, to, run: [found.run.a.position, found.run.b.position], relation: found.relation }], key };
}

/** What the protractor counts from. */
interface Reference {
  readonly heading: number;
  /** The side it is the direction of; absent for the world's x axis. */
  readonly run?: LinkRun;
}

/**
 * The directions the protractor offers at once: the side standing nearest
 * where the line began, when one is near, and the world's x axis. Both are
 * there -- a line may follow the wall beside it or the compass -- and the
 * guide names the one that caught, so which is which is never a guess.
 */
function protractorReferences(query: RulerQuery, origin: ConstructionPosition): readonly Reference[] {
  let best: { run: LinkRun; distance: number } | undefined;
  for (const run of query.links.runs) {
    const distance = nearestOnSegment(origin, run.a.position, run.b.position).distance;
    if (distance <= ANGLE_RANGE && (!best || distance < best.distance)) best = { run, distance };
  }
  const world: Reference = { heading: 0 };
  if (!best) return [world];
  const { a, b } = best.run;
  return [{ heading: Math.atan2(b.position.z - a.position.z, b.position.x - a.position.x), run: best.run }, world];
}

/** The line from where the drawing began, turned onto the nearest step of the protractor -- from a side or from the world -- keeping its length. */
function polarFix(query: RulerQuery, p: ConstructionPosition, rc: Reach): Fix | undefined {
  const origin = query.origin, step = query.polar;
  if (!origin || !step || step <= 0 || query.motion?.kind === "line" || !on(query, "polar")) return undefined;
  const dx = p.x - origin.x, dz = p.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return undefined;
  const heading = Math.atan2(dz, dx);
  let best: Fix | undefined;
  // The side comes first: it wins a tie against the world.
  for (const reference of protractorReferences(query, origin)) {
    const turns = Math.round((heading - reference.heading) / step);
    const key = `polar:${reference.run ? runKeyOf(reference.run) : "world"}:${turns}`;
    const target = reference.heading + turns * step;
    if (Math.abs(heading - target) > angularReach(rc.of(key), length, Math.min(ANGLE_REACH, step / 2.5))) continue;
    const to = { x: origin.x + Math.cos(target) * length, y: p.y, z: origin.z + Math.sin(target) * length };
    const fix = { x: to.x - p.x, z: to.z - p.z };
    const degrees = ((((turns * step) / DEGREE) % 360) + 360) % 360;
    // The side wins a tie, not floating-point luck: the world only when it is truly nearer.
    best = nearer(best, { ...fix, distance: Math.hypot(fix.x, fix.z) + (reference.run ? 0 : 1e-9), guides: [{ kind: "polar", origin, to, degrees, from: reference.run ? "edge" : "world", zero: reference.heading }], key });
  }
  return best;
}

function reachOf(query: RulerQuery): Reach {
  const reach = query.reach ?? RULER_REACH;
  const of = (key: string): number => (query.holding === key ? reach * HOLD_FACTOR : reach);
  return { reach, of, within: (distance, key) => distance <= of(key) };
}

/** What the ruler says of a point on the ground: where it lands, what to draw and what to measure. */
export function resolveRuler(query: RulerQuery): RulerResult {
  const rc = reachOf(query);
  const p = query.point;
  const lines = lineFix(query, p, rc);
  // A corner beats a side, a side beats a crossing, a crossing beats a line, a line beats a direction, a direction beats a matched length.
  const picks: readonly (readonly [RulerResult["caught"], Fix | undefined])[] = [
    ["point", cornerFix(query, p, rc)],
    ["run", sideFix(query, p, rc)],
    [lines?.caught, lines?.fix],
    ["angle", angleFix(query, p, rc)],
    ["polar", polarFix(query, p, rc)],
    ["length", lengthFix(query, p, rc)],
  ];
  const [picked, first] = picks.find(([, candidate]) => candidate) ?? [undefined, undefined];
  // A length that is a round number is said so: it is not a side's length.
  const caught = picked === "length" && first?.guides[0]?.kind === "step" ? "step" : picked;
  let fix = first;
  // A line turned onto a direction can still be as long as a standing side: both hold at once.
  if ((caught === "angle" || caught === "polar") && fix) {
    const turned = { x: p.x + fix.x, y: p.y, z: p.z + fix.z };
    const matched = lengthFix(query, turned, rc);
    if (matched) fix = { x: fix.x + matched.x, z: fix.z + matched.z, distance: fix.distance + matched.distance, guides: [...fix.guides, ...matched.guides], key: fix.key };
  }
  const position = fix && query.snap !== false ? { x: p.x + fix.x, y: p.y, z: p.z + fix.z } : p;
  return { position, caught: fix ? caught : undefined, key: fix?.key, guides: fix?.guides ?? [], measures: measuresAt(query, position) };
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
      if (heading) measures.push({ kind: "angle", degrees: (heading.deviation * 180) / Math.PI, reference: { run: [heading.run.a.position, heading.run.b.position], relation: heading.relation } });
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
export function resolveLevel(y: number, links: RulerLinks, at: ConstructionPosition, options: { readonly snap?: boolean; readonly reach?: number; readonly disabled?: ReadonlySet<RulerKind> } = {}): { readonly y: number; readonly guide?: RulerGuide } {
  if (options.disabled?.has("level")) return { y };
  const reach = options.reach ?? LEVEL_REACH;
  let best: number | undefined;
  for (const level of links.levels) if (Math.abs(level - y) <= reach && (best === undefined || Math.abs(level - y) < Math.abs(best - y))) best = level;
  if (best === undefined) return { y };
  return { y: options.snap === false ? y : best, guide: { kind: "level", y: best, at } };
}

/**
 * `value` rounded to a multiple of `step` when within `reach` of one; `undefined`
 * when it is not near one, or there is no step. What makes a height, a length or
 * a size land on a whole number of the table's unit.
 */
export function roundWithin(value: number, step: number, reach: number): number | undefined {
  if (!(step > 0)) return undefined;
  const rounded = Math.round(value / step) * step;
  return Math.abs(rounded - value) <= reach ? rounded : undefined;
}

/**
 * `angle` -- a turn, in radians -- landed on the nearest multiple of `step` when
 * within a few pixels of one, seen from `radius` away: the same reach as every
 * other catch, so a wide turn is held to a finer angle than a tight one.
 * `undefined` when it is near none, or there is no step.
 */
export function snapTurn(angle: number, step: number, reach: number, radius: number): { readonly angle: number; readonly turns: number } | undefined {
  if (!(step > 0) || !(radius > 0)) return undefined;
  const turns = Math.round(angle / step);
  const target = turns * step;
  return Math.abs(angle - target) <= angularReach(reach, radius, Math.min(ANGLE_REACH, step / 2.5)) ? { angle: target, turns } : undefined;
}
