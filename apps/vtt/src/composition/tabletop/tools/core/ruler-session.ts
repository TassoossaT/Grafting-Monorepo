import { collectLinks, isGroundType, resolveRuler, type PlanVector, type RulerGuide, type RulerLinks, type RulerMeasure } from "../../../../features/edit-construction/index.ts";
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

export interface RulePointOptions {
  /** Whether what the ruler catches is taken. */
  readonly snap: boolean;
  /** Where what is being drawn began, to measure its length from. */
  readonly origin?: ConstructionPosition;
  /** The directions to line up along -- a build frame's. */
  readonly axes?: readonly [PlanVector, PlanVector];
}

export interface RulerSession {
  /** What stands changed: the links are read again on the next question. */
  invalidate(): void;
  links(): RulerLinks;
  rulePoint(point: ConstructionPosition, options: RulePointOptions): { readonly point: ConstructionPosition; readonly feedback: RulerFeedback };
  ruleSample(sample: PointerSample, options: RulePointOptions): { readonly sample: PointerSample; readonly feedback: RulerFeedback };
}

export const NO_FEEDBACK: RulerFeedback = { guides: [], measures: [] };

/** What a tool's own context offers the ruler: the table to read and whether the snap is on. */
export interface RulerHost {
  readonly runtime: { getAllRegionTopologies(): readonly ConstructionRegionTopology[] };
  readonly rulerSnap: boolean;
}

/** A point a tool lays out itself -- a frame's corner -- ruled like every other, by the table as it stands now. */
export function rulePointFor(host: RulerHost, point: ConstructionPosition, options: Omit<RulePointOptions, "snap"> = {}): ConstructionPosition {
  const links = collectLinks(host.runtime.getAllRegionTopologies(), { isGround: isGroundType });
  return resolveRuler({ point, links, snap: host.rulerSnap, ...(options.origin ? { origin: options.origin } : {}), ...(options.axes ? { axes: options.axes } : {}) }).position;
}

/** A session reading the links from `topologies()` -- once, until something stands differently. */
export function createRulerSession(topologies: () => readonly ConstructionRegionTopology[]): RulerSession {
  let cached: RulerLinks | undefined;
  const links = (): RulerLinks => (cached ??= collectLinks(topologies(), { isGround: isGroundType }));
  const rulePoint: RulerSession["rulePoint"] = (point, options) => {
    const result = resolveRuler({ point, links: links(), snap: options.snap, ...(options.origin ? { origin: options.origin } : {}), ...(options.axes ? { axes: options.axes } : {}) });
    return { point: result.position, feedback: { guides: result.guides, measures: result.measures } };
  };
  return {
    invalidate() { cached = undefined; },
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
