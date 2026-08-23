import { planEdit, refreshCloudTopology, resolveCloudTopology, cloudNodes } from "@/features/edit-construction";
import type { AtomicEditOp, CloudTopology, EditTarget } from "@/features/edit-construction";
import type { ConstructionPosition, ConstructionRegionTopology, ConstructionSurfaceKey } from "@/ports";

import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";

import { distanceToSegmentXZ } from "../shapes/geometry-2d.ts";
import type { ConstructionTool, PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

/**
 * Edit mode: grab a cloud by any of its parts -- a vertex, a boundary edge,
 * or the body -- and what that gesture is *allowed* to do is decided by the
 * grabbed part's role in the cloud's own type. A wall's top corner only
 * moves vertically, its bottom corner drags its paired top corner along,
 * grabbing its body moves the whole run rather than shearing one panel out
 * of it, and a terrain patch refuses fine-grained edits outright.
 *
 * **The cloud is what is being edited, never the face under the pointer**
 * (`ADR-0022`: "editing dispatches by cloud, not by individual surface").
 * The face still says *what was grabbed* -- a corner is a corner of a panel,
 * and no cloud-wide question has an answer for a single node -- but the
 * reach of the resulting op comes from the role's own declaration in
 * `features/edit-construction/structure-types/`.
 *
 * The tool itself contains **no** per-type behavior. It resolves the cloud
 * and the target, hands both to `planEdit`, and applies whatever plan comes
 * back; adding a structure type never means touching this file, and neither
 * does adding a preset that produces one.
 */

/** Same tolerance the wall tools pick a panel with -- an edge grab is deliberate, not a snap. */
const EDGE_PICK_TOLERANCE = 0.2;

interface GrabbedTarget {
  readonly seedKey: ConstructionSurfaceKey;
  readonly target: EditTarget;
}

const xzDistanceToSegment = distanceToSegmentXZ;

/**
 * What the pointer grabbed: the node handle it hit, else the boundary edge
 * it landed on, else the region body. A node handle already reports its own
 * id, so a vertex grab needs no geometric search -- only which face to seed
 * the cloud from.
 *
 * A node welded between two clouds of *different* types belongs to both, and
 * the first match wins. That ambiguity predates cloud dispatch and is not
 * resolved here: it is a question about what a shared node means, not about
 * scope.
 */
function grabbedTarget(ctx: ToolContext, sample: PointerSample): GrabbedTarget | undefined {
  const topologies = ctx.runtime.getAllRegionTopologies();

  if (sample.nodeId !== undefined) {
    const nodeId = sample.nodeId;
    const topology = topologies.find((candidate) => candidate.nodes.some((node) => node.id === nodeId));
    return topology === undefined
      ? undefined
      : { seedKey: topology.surfaceKey, target: { kind: "vertex", nodeId } };
  }

  if (sample.surfaceRef === undefined) return undefined;
  const surfaceRef = sample.surfaceRef;
  const topology = topologies.find(
    (candidate) => surfaceRefFromNodeSet(candidate.surfaceKey) === surfaceRef,
  );
  if (topology === undefined) return undefined;
  return { seedKey: topology.surfaceKey, target: edgeOrBodyAt(topology, sample.point) };
}

/** The boundary edge `point` landed on, or the body when it landed on none. */
function edgeOrBodyAt(topology: ConstructionRegionTopology, point: ConstructionPosition): EditTarget {
  const positionOf = (id: string): ConstructionPosition | undefined =>
    topology.nodes.find((node) => node.id === id)?.position;
  let closest: { readonly edgeId: string; readonly distance: number } | undefined;
  for (const loop of [...topology.outerLoops, ...topology.holes]) {
    for (const edge of loop) {
      const start = positionOf(edge.startNodeId);
      const end = positionOf(edge.endNodeId);
      if (start === undefined || end === undefined) continue;
      const distance = xzDistanceToSegment(point, start, end);
      if (distance > EDGE_PICK_TOLERANCE) continue;
      if (closest === undefined || distance < closest.distance) closest = { edgeId: edge.edgeId, distance };
    }
  }
  return closest === undefined ? { kind: "region" } : { kind: "edge", edgeId: closest.edgeId };
}

function delta(from: ConstructionPosition, to: ConstructionPosition): ConstructionPosition {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}

/**
 * Every node of the cloud whose position differs from the captured
 * snapshot -- what an undo has to put back.
 *
 * Snapshotted across the whole cloud, for the same reason the plan is:
 * a cloud-scoped move addresses every member, and a cascade (plus the
 * engine's own cleanup) moves nodes the gesture never named. A snapshot of
 * only the seed would leave an undo that puts one panel back and abandons
 * the rest of the run where the drag left it.
 */
function restoreOps(
  before: ReadonlyMap<string, ConstructionPosition>,
  after: CloudTopology,
): { readonly undo: readonly AtomicEditOp[]; readonly redo: readonly AtomicEditOp[] } {
  const undo: AtomicEditOp[] = [];
  const redo: AtomicEditOp[] = [];
  for (const node of cloudNodes(after)) {
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
  readonly cloud: CloudTopology;
  readonly target: EditTarget;
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
      ctx.reportFeedback(undefined);
      return;
    }
    const cloud = resolveCloudTopology(ctx.runtime, grabbed.seedKey);
    if (cloud === undefined) {
      ctx.reportSelection(undefined);
      return;
    }
    active = {
      cloud,
      target: grabbed.target,
      before: new Map(cloudNodes(cloud).map((node) => [node.id, node.position])),
      previous: sample.point,
    };
    if (grabbed.target.kind === "vertex") {
      ctx.reportSelection({ id: grabbed.target.nodeId, point: sample.point });
    }
  },

  onPointerMove(ctx: ToolContext, gesture: ToolGesture): void {
    if (active === undefined) return;
    // Per-tick delta, not gesture-total: every op the plan produces applies
    // on top of the cloud's *current* state, so a cumulative delta would
    // move everything again on each tick.
    const step = delta(active.previous, gesture.current.point);
    if (step.x === 0 && step.y === 0 && step.z === 0) return;
    active.previous = gesture.current.point;

    // Positions are re-read every tick; membership is not. A drag that welds
    // onto a neighbour must not silently enlarge what it is dragging.
    const cloud = refreshCloudTopology(ctx.runtime, active.cloud.cloud);
    if (cloud === undefined) return;

    const plan = planEdit(cloud, {
      surfaceKey: cloud.cloud.seed,
      target: active.target,
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
    // The handle-design notes call out that a drag gives no signal of how
    // much it is about to affect. The plan already knows, so say it.
    ctx.reportFeedback({
      tone: "info",
      message:
        plan.scope === "cloud"
          ? `${cloud.cloud.surfaceType}: movendo ${plan.surfaceCount} ${plan.surfaceCount === 1 ? "superficie" : "superficies"} da nuvem.`
          : `${cloud.cloud.surfaceType}: ${plan.role}.`,
    });
    if (active.target.kind === "vertex") {
      ctx.reportSelection({ id: active.target.nodeId, point: gesture.current.point });
    }
  },

  onPointerUp(ctx: ToolContext): void {
    const drag = active;
    active = undefined;
    if (drag === undefined) return;
    const cloud = refreshCloudTopology(ctx.runtime, drag.cloud.cloud);
    if (cloud === undefined) return;
    const { undo, redo } = restoreOps(drag.before, cloud);
    if (undo.length === 0) return;
    ctx.history.record({ kind: "region-edit", undo, redo });
  },
};
