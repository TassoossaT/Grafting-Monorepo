import { ROUND_REACH_PIXELS, collectLinks, isGroundType, resolveRuler, type PlanVector, type RulerGuide, type RulerKind, type RulerLinks, type RulerMeasure, type RulerResult } from "../../../../features/edit-construction/index.ts";
import type { ConstructionPosition, ConstructionRegionTopology } from "../../../../ports/index.ts";
import type { PointerSample } from "./tool-context.ts";

/**
 * Where the ruler meets the tools: the one place that turns what stands into
 * links and a pointer position into a ruled one. The dispatcher rules every
 * ground sample here before a tool sees it, and a tool that rules a point of
 * its own -- a build frame's corner -- asks the same session, so no tool
 * derives a link itself.
 */

/** What the ruler shows for the point it last ruled -- always while building, whether or not the snap is on. */
export interface RulerFeedback {
  readonly guides: readonly RulerGuide[];
  readonly measures: readonly RulerMeasure[];
}

/** How close, on the screen, a link must come to catch. In pixels, so the feel is the same at every zoom. */
export const RULER_REACH_PX = 14;
/** How far, on the screen, a link may stand and still offer its lines. */
export const RULER_ACQUIRE_PX = 160;
/** What a catch's reach never goes below or beyond, in metres, however close or far the camera. */
const REACH_LIMITS: readonly [number, number] = [0.04, 1.2];

/** `pixels` of the screen as metres, given the metres a pixel is; `fallback` when the scale is unknown. */
export function metersFor(metersPerPixel: number | undefined, pixels: number, fallback: number, limits: readonly [number, number] = REACH_LIMITS): number {
  if (metersPerPixel === undefined || !(metersPerPixel > 0)) return fallback;
  return Math.max(limits[0], Math.min(limits[1], pixels * metersPerPixel));
}

export interface RulePointOptions {
  /** Whether what the ruler catches is taken. */
  readonly snap: boolean;
  /** Where what is being drawn began, to measure its length from. */
  readonly origin?: ConstructionPosition;
  /** The directions to line up along -- a build frame's. */
  readonly axes?: readonly [PlanVector, PlanVector];
  /** How many metres a pixel of the screen is here: the reach and the acquiring are worked out from it. */
  readonly metersPerPixel?: number;
  /** The steps of the protractor from the origin, in radians. */
  readonly polar?: number;
  /** The round number, in metres, a length from the origin lands on; none when absent. */
  readonly lengthStep?: number;
  /** Ways of catching the table left out. */
  readonly disabled?: ReadonlySet<RulerKind>;
  /** Links by node id the point never joins. */
  readonly skip?: ReadonlySet<string>;
}

export interface RulerSession {
  /** What stands changed: the links are read again on the next question. */
  invalidate(): void;
  /** The pointer is done with this catch -- a gesture ended: the next one starts free. */
  release(): void;
  links(): RulerLinks;
  rulePoint(point: ConstructionPosition, options: RulePointOptions): { readonly point: ConstructionPosition; readonly feedback: RulerFeedback };
  ruleSample(sample: PointerSample, options: RulePointOptions): { readonly sample: PointerSample; readonly feedback: RulerFeedback };
}

export const NO_FEEDBACK: RulerFeedback = { guides: [], measures: [] };

function queryOf(point: ConstructionPosition, links: RulerLinks, options: RulePointOptions, holding?: string) {
  const scale = options.metersPerPixel;
  return {
    point, links, snap: options.snap,
    ...(options.origin ? { origin: options.origin } : {}),
    ...(options.axes ? { axes: options.axes } : {}),
    ...(scale !== undefined ? { reach: metersFor(scale, RULER_REACH_PX, 0.2), acquire: metersFor(scale, RULER_ACQUIRE_PX, 8, [1, 40]) } : {}),
    ...(holding !== undefined ? { holding } : {}),
    ...(options.polar !== undefined ? { polar: options.polar } : {}),
    ...(options.lengthStep !== undefined && options.lengthStep > 0 ? { lengthStep: options.lengthStep, ...(scale !== undefined ? { stepReach: metersFor(scale, ROUND_REACH_PIXELS, 0.34) } : {}) } : {}),
    ...(options.disabled ? { disabled: options.disabled } : {}),
    ...(options.skip ? { skip: options.skip } : {}),
  };
}

/** A session reading the links from `topologies()` -- once, until something stands differently. */
export function createRulerSession(topologies: () => readonly ConstructionRegionTopology[]): RulerSession {
  let cached: RulerLinks | undefined;
  /** The catch last held: it stays on a little past the reach, so the point does not flicker at the edge. */
  let holding: string | undefined;
  const links = (): RulerLinks => (cached ??= collectLinks(topologies(), { isGround: isGroundType }));
  const rulePoint: RulerSession["rulePoint"] = (point, options) => {
    const result = resolveRuler(queryOf(point, links(), options, holding));
    holding = result.key;
    return { point: result.position, feedback: { guides: result.guides, measures: result.measures } };
  };
  return {
    invalidate() { cached = undefined; holding = undefined; },
    release() { holding = undefined; },
    links,
    rulePoint,
    ruleSample(sample, options) {
      // A node handle stays precise: moving an existing node is never ruled by position.
      if (sample.nodeId !== undefined) return { sample, feedback: NO_FEEDBACK };
      const ruled = rulePoint(sample.point, options);
      // How far the ruler moved the hit travels with the sample, for a tool that reads the pointer's ray instead of its point.
      const moved = { x: ruled.point.x - sample.point.x, z: ruled.point.z - sample.point.z };
      const caught = Math.abs(moved.x) > 1e-9 || Math.abs(moved.z) > 1e-9;
      return { sample: { ...sample, point: ruled.point, ...(caught ? { ruled: moved } : {}) }, feedback: ruled.feedback };
    },
  };
}

/** What a tool's own context offers the ruler: the table to read, whether the snap is on, and the screen's scale. */
export interface RulerHost {
  readonly runtime: { getAllRegionTopologies(): readonly ConstructionRegionTopology[] };
  readonly rulerSnap: boolean;
  /** How many metres a pixel of the screen is at the pointer, when the dispatcher knows. */
  readonly rulerMetersPerPixel?: number;
  /** Ways of catching the table left out. */
  readonly rulerDisabled?: ReadonlySet<RulerKind>;
  /** The angular step the protractor offers now, in radians. */
  readonly rulerAngleStep?: number;
  /** The round number a length lands on, in metres. */
  readonly rulerLengthStep?: number;
}

/** The reach, in metres, that `pixels` of the screen make for `host`; `fallback` when its scale is unknown. */
export function reachFor(host: Pick<RulerHost, "rulerMetersPerPixel">, pixels: number, fallback: number): number {
  return metersFor(host.rulerMetersPerPixel, pixels, fallback);
}

/** A point a tool lays out itself -- a frame's corner -- ruled like every other, by the table as it stands now. */
export function rulePointFor(host: RulerHost, point: ConstructionPosition, options: Pick<RulePointOptions, "origin" | "axes"> = {}): ConstructionPosition {
  const links = collectLinks(host.runtime.getAllRegionTopologies(), { isGround: isGroundType });
  return resolveRuler(queryOf(point, links, { snap: host.rulerSnap, ...options, ...(host.rulerMetersPerPixel !== undefined ? { metersPerPixel: host.rulerMetersPerPixel } : {}), ...(host.rulerDisabled ? { disabled: host.rulerDisabled } : {}) })).position;
}

/**
 * A line from `origin` to `point`, ruled by the host's choices: its angle on
 * the protractor's steps -- or parallel and square to the sides of `links` --
 * and its length on the round number, with what caught and what to say of it.
 * The one answer for any line drawn or edited, from wherever it starts.
 */
export function ruleLineFor(host: RulerHost, point: ConstructionPosition, options: { readonly origin: ConstructionPosition; readonly links: RulerLinks; readonly skip?: ReadonlySet<string> }): RulerResult {
  return resolveRuler(queryOf(point, options.links, {
    snap: host.rulerSnap,
    origin: options.origin,
    ...(options.skip ? { skip: options.skip } : {}),
    ...(host.rulerAngleStep !== undefined ? { polar: host.rulerAngleStep } : {}),
    ...(host.rulerLengthStep !== undefined ? { lengthStep: host.rulerLengthStep } : {}),
    ...(host.rulerMetersPerPixel !== undefined ? { metersPerPixel: host.rulerMetersPerPixel } : {}),
    ...(host.rulerDisabled ? { disabled: host.rulerDisabled } : {}),
  }));
}
