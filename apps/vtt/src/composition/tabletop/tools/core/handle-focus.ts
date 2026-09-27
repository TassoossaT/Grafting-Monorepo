import { curvePick, globalHandleOf, isSpineEdge, spineComponent, spineMemberOf, structureTypeFor, type HandleFocus } from "../../../../features/edit-construction/index.ts";
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import type { ConstructionPosition } from "../../../../ports/index.ts";
import { pointerAtHeight } from "./pointer-ray.ts";
import { spineBodyTarget } from "./spine-body-target.ts";
import type { PointerSample, ToolContext } from "./tool-context.ts";

/**
 * Which structure's handles show: the one under the pointer. The handles
 * stand just outside it, so the focus holds while the pointer is on one of
 * them, or still within {@link KEEP} of the structure on its way to one --
 * and moves on as soon as it is over another structure.
 */

/** How far outside a focused structure, in plan, the pointer may go and keep its handles showing. */
const KEEP = 1.8;

const keyOf = (surfaceKey: readonly string[]) => surfaceKey.join("\u0000");
export const NO_FOCUS: HandleFocus = Object.freeze({ faces: new Set<string>(), spineNodes: new Set<string>() });

/** The structure of a type `owns` accepts that `sample` is over, if any. */
function focusUnder(ctx: ToolContext, sample: PointerSample, owns: (surfaceType: string) => boolean): HandleFocus | undefined {
  const topology = sample.surfaceRef === undefined ? undefined
    : ctx.runtime.getAllRegionTopologies().find((candidate) => surfaceRefFromNodeSet(candidate.surfaceKey) === sample.surfaceRef);
  if (!topology || !owns(topology.surfaceType)) return undefined;
  if (structureTypeFor(topology.surfaceType)?.spine === undefined) return { faces: new Set([keyOf(topology.surfaceKey)]), spineNodes: new Set() };
  const body = spineBodyTarget(ctx, sample, undefined, owns);
  if (!body?.sample.nodeId) return undefined;
  const graph = ctx.runtime.getGraphSnapshot();
  const spans = spineComponent(graph, [spineMemberOf(graph, body.sample.nodeId)]).edges.filter(isSpineEdge);
  return { faces: new Set(), spineNodes: new Set(spans.flatMap((span) => [span.startNodeId, span.endNodeId])) };
}

/** Every point of the focused structure, where it stands. */
function focusPoints(ctx: ToolContext, focus: HandleFocus): readonly ConstructionPosition[] {
  const faces = ctx.runtime.getAllRegionTopologies().filter((topology) => focus.faces.has(keyOf(topology.surfaceKey)));
  const nodes = faces.flatMap((face) => face.nodes.map((node) => node.position));
  if (focus.spineNodes.size === 0) return nodes;
  return [...nodes, ...ctx.runtime.getGraphSnapshot().nodes.filter((node) => focus.spineNodes.has(node.id)).map((node) => node.position)];
}

/** Whether the pointer is still within reach of `focus`'s handles, around the structure in plan. */
function near(ctx: ToolContext, sample: PointerSample, focus: HandleFocus): boolean {
  const points = focusPoints(ctx, focus);
  if (points.length === 0) return false;
  const min = { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) };
  const max = { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) };
  const at = sample.ray ? pointerAtHeight(sample, points.reduce((sum, p) => sum + p.y, 0) / points.length) : sample.point;
  return at.x >= min.x - KEEP && at.x <= max.x + KEEP && at.z >= min.z - KEEP && at.z <= max.z + KEEP;
}

/**
 * The focus after the pointer moved to `sample`: the structure it is over,
 * else the one it was on while it stays on that one's handles or near it,
 * else none.
 */
export function handleFocusAt(ctx: ToolContext, sample: PointerSample | undefined, previous: HandleFocus, owns: (surfaceType: string) => boolean): HandleFocus {
  if (!sample) return NO_FOCUS;
  // On a handle: whatever it belongs to stays in focus.
  if (sample.nodeId && (globalHandleOf(sample.nodeId) || curvePick(sample.nodeId))) return previous;
  const under = focusUnder(ctx, sample, owns);
  if (under) return under;
  if (sample.nodeId && previous.spineNodes.has(sample.nodeId)) return previous;
  return (previous.faces.size > 0 || previous.spineNodes.size > 0) && near(ctx, sample, previous) ? previous : NO_FOCUS;
}

/** Whether two foci show the same handles. */
export function sameFocus(a: HandleFocus | undefined, b: HandleFocus | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.faces.size !== b.faces.size || a.spineNodes.size !== b.spineNodes.size) return false;
  return [...a.faces].every((key) => b.faces.has(key)) && [...a.spineNodes].every((id) => b.spineNodes.has(id));
}
