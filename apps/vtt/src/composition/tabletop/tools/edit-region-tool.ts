import { planEdit, type AtomicEditOp, type EditTarget } from "@/features/edit-construction";
import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { surfaceRefFromNodeSet } from "../../../entities/map/index.ts";

import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

/**
 * Edit mode: drag a region's vertex, edge, or body, with what that gesture
 * is *allowed* to do decided by the grabbed part's own role in its structure
 * type -- a wall's top corner only moves vertically, its bottom corner drags
 * its paired top corner along, a terrain patch refuses fine-grained edits
 * outright. See `docs/architecture/vtt-atomic-edit-and-cloud-policy-design.md`.
 *
 * The tool itself contains **no** per-type behavior. It resolves the target,
 * hands the gesture to `planEdit`, and applies whatever plan comes back;
 * every rule lives in `features/edit-construction/structure-types/`, so
 * adding a structure type never means touching this file.
 */

/** Same tolerance the wall tools pick a panel with -- an edge grab is deliberate, not a snap. */
const EDGE_PICK_TOLERANCE = 0.2;

interface GrabbedTarget {
  readonly topology: ConstructionRegionTopology;
  readonly target: EditTarget;
}

function xzDistanceToSegment(
  point: ConstructionPosition,
  a: ConstructionPosition,
  b: ConstructionPosition,
): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  if (lengthSq < 1e-9) return Math.hypot(point.x - a.x, point.z - a.z);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq));
  return Math.hypot(point.x - (a.x + t * abx), point.z - (a.z + t * abz));
}

/**
 * What the pointer grabbed: the node handle it hit, else the boundary edge
 * it landed on, else the region body. A node handle already reports its own
 * id, so a vertex grab needs no geometric search -- only the region it
 * belongs to.
 */
function grabbedTarget(ctx: ToolContext, sample: PointerSample): GrabbedTarget | undefined {
  const topologies = ctx.runtime.getAllRegionTopologies();

  if (sample.nodeId !== undefined) {
    const nodeId = sample.nodeId;
    const topology = topologies.find((candidate) =>
      candidate.nodes.some((node) => node.id === nodeId),
    );
    return topology === undefined ? undefined : { topology, target: { kind: "vertex", nodeId } };
  }

  if (sample.surfaceRef === undefined) return undefined;
  const surfaceRef = sample.surfaceRef;
  const topology = topologies.find(
    (candidate) => surfaceRefFromNodeSet(candidate.surfaceKey) === surfaceRef,
  );
  if (topology === undefined) return undefined;

  const positionOf = (id: string): ConstructionPosition | undefined =>
    topology.nodes.find((node) => node.id === id)?.position;
  let closest: { readonly edgeId: string; readonly distance: number } | undefined;
  for (const loop of [...topology.outerLoops, ...topology.holes]) {
    for (const edge of loop) {
      const start = positionOf(edge.startNodeId);
      const end = positionOf(edge.endNodeId);
      if (start === undefined || end === undefined) continue;
      const distance = xzDistanceToSegment(sample.point, start, end);
      if (distance > EDGE_PICK_TOLERANCE) continue;
      if (closest === undefined || distance < closest.distance) closest = { edgeId: edge.edgeId, distance };
    }
  }
  return closest === undefined
    ? { topology, target: { kind: "region" } }
    : { topology, target: { kind: "edge", edgeId: closest.edgeId } };
}

function delta(from: ConstructionPosition, to: ConstructionPosition): ConstructionPosition {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}

/**
 * Every boundary node of `topology` whose position differs from the
 * captured snapshot -- what an undo has to put back. A cascade (and the
 * engine's own cleanup) moves nodes this tool never named, so the snapshot
 * covers the whole region rather than only the grabbed vertex.
 */
function restoreOps(
  before: ReadonlyMap<string, ConstructionPosition>,
  after: ConstructionRegionTopology,
): { readonly undo: readonly AtomicEditOp[]; readonly redo: readonly AtomicEditOp[] } {
  const undo: AtomicEditOp[] = [];
  const redo: AtomicEditOp[] = [];
  for (const node of after.nodes) {
    const original = before.get(node.id);
    if (original === undefined) continue;
    if (
      Math.abs(original.x - node.position.x) < 1e-6 &&
      Math.abs(original.y - node.position.y) < 1e-6 &&
      Math.abs(original.z - node.position.z) < 1e-6
    ) {
      continue;
    }
    undo.push({ kind: "move-vertex", nodeId: node.id, position: original });
    redo.push({ kind: "move-vertex", nodeId: node.id, position: node.position });
  }
  return { undo, redo };
}

interface ActiveDrag {
  readonly grabbed: GrabbedTarget;
  readonly before: ReadonlyMap<string, ConstructionPosition>;
  previous: ConstructionPosition;
}

let active: ActiveDrag | undefined;

export const editRegionTool: ConstructionTool<"edit-region"> = {
  id: "edit-region",
  defaultParams: () => ({}),

  onPointerDown(ctx: ToolContext, sample: PointerSample): void {
    active = undefined;
    const grabbed = grabbedTarget(ctx, sample);
    if (grabbed === undefined) {
      ctx.reportSelection(undefined);
      return;
    }
    active = {
      grabbed,
      before: new Map(grabbed.topology.nodes.map((node) => [node.id, node.position])),
      previous: sample.point,
    };
    if (grabbed.target.kind === "vertex") {
      ctx.reportSelection({ id: grabbed.target.nodeId, point: sample.point });
    }
  },

  onPointerMove(ctx: ToolContext, gesture: ToolGesture): void {
    if (active === undefined) return;
    // Per-tick delta, not gesture-total: every op the plan produces applies
    // on top of the region's *current* state, so a cumulative delta would
    // move everything again on each tick.
    const step = delta(active.previous, gesture.current.point);
    if (step.x === 0 && step.y === 0 && step.z === 0) return;
    active.previous = gesture.current.point;

    const topology = ctx.runtime.getRegionTopology(active.grabbed.topology.surfaceKey);
    if (topology === undefined) return;

    const plan = planEdit(topology, {
      surfaceKey: topology.surfaceKey,
      target: active.grabbed.target,
      delta: step,
    });
    if (plan.kind === "deny") {
      ctx.reportFeedback({ tone: "error", message: plan.reason });
      active = undefined;
      return;
    }
    if (plan.kind === "regenerate") {
      ctx.reportFeedback({ tone: "info", message: plan.reason });
      active = undefined;
      return;
    }
    ctx.runtime.applyRegionEdit(plan.ops, "local", `edit:${plan.role}`);
    if (active.grabbed.target.kind === "vertex") {
      ctx.reportSelection({ id: active.grabbed.target.nodeId, point: gesture.current.point });
    }
  },

  onPointerUp(ctx: ToolContext): void {
    const drag = active;
    active = undefined;
    if (drag === undefined) return;
    const topology = ctx.runtime.getRegionTopology(drag.grabbed.topology.surfaceKey);
    if (topology === undefined) return;
    const { undo, redo } = restoreOps(drag.before, topology);
    if (undo.length === 0) return;
    ctx.history.record({ kind: "region-edit", undo, redo });
  },
};
