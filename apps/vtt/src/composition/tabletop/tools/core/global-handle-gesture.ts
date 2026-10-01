import {
  arcsFollowing,
  floorsWeldedBy,
  hasTrait,
  joinWhereLanded,
  rejoinNodes,
  releasePart,
  HANDLE_MEASUREMENT,
  HANDLE_REFERENCE,
  editNeighbours,
  rotateInPlan,
  snapAnchorsOf,
  snapLinksOf,
  reshapedWelds,
  reweld,
  unweld,
  endJoinsOf,
  type WeldLink,
  planEdit,
  planGlobalHandle,
  resolveCloudTopology,
  resolvePolicy,
  shownGlobalHandleAt,
  type AtomicEditOp,
  type GlobalHandle,
  type GlobalHandleEdit,
  type GlobalHandleIntent,
  type GlobalHandleScene,
} from "../../../../features/edit-construction/index.ts";
import type { ApplyPatchReplacementRequest, ConstructionEdgeGeometry, ConstructionPosition } from "../../../../ports/index.ts";
import type { CurveGesture, CurveGestureOptions } from "./curve-edit-gesture.ts";
import { commitSpineRegeneration, regenerateSpine } from "./spine-commit.ts";
import { createConstrainedDrag } from "./constrained-drag.ts";
import { floorsOf, floorUnder } from "./floor-landing.ts";
import { commitPatchReplacement, commitRegionEdit, commitStagedRegionEdit } from "../../effects/effect-commit.ts";
import { rulerOf, type OutlineSnap, type RulerGuide, type RulerMeasure } from "./ruler.ts";
import type { PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";
import { HANDLE_DONE } from "../../handle-glyphs.ts";
import { faceKey, surfaceKeyText } from "../../../../features/edit-construction/index.ts";
import { keepFaceProps, pinnedToRoles } from "./face-props.ts";

const CHANNEL = "global-handle";
const PREVIEW_COLOR = 0xffbc55;


function sceneOf(ctx: ToolContext): GlobalHandleScene {
  return { graph: ctx.runtime.getGraphSnapshot(), topologies: ctx.runtime.getAllRegionTopologies(), cloudFor: (request) => ctx.runtime.cloudFor(request) };
}

/** The live position of every node an edit moves -- what its outline preview is drawn with. */
function movedPositions(ctx: ToolContext, handle: GlobalHandle, edit: GlobalHandleEdit, scene: GlobalHandleScene): ReadonlyMap<string, ConstructionPosition> {
  if (edit.kind === "vertices") return new Map(edit.moves.map((move) => [move.nodeId, move.position]));
  if (edit.kind !== "region-move") return new Map();
  const positions = new Map(scene.graph.nodes.map((node) => [node.id, node.position]));
  return new Map(handle.nodeIds.map((id) => {
    const p = positions.get(id)!;
    return [id, { x: p.x + edit.delta.x, y: p.y + edit.delta.y, z: p.z + edit.delta.z }] as const;
  }));
}

/** The outline of every face a replacement puts in place. */
function replacementOutline(request: ApplyPatchReplacementRequest): Float32Array {
  const positions = new Map(request.patch.nodes.map((node) => [node.id, node.position]));
  const edges = new Map(request.patch.edges.map((edge) => [edge.edgeId, edge]));
  const segments: number[] = [];
  for (const use of request.patch.regions.flatMap((region) => [region.boundary, ...(region.holes ?? [])]).flat()) {
    const edge = edges.get(use.edgeId);
    const a = edge && positions.get(edge.startNodeId), b = edge && positions.get(edge.endNodeId);
    if (a && b) segments.push(a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z);
  }
  return Float32Array.from(segments);
}

/** An edit's preview: the owner's regenerated spine, the faces a replacement puts in place, or the moved outline of the structure's faces. */
function previewOf(ctx: ToolContext, handle: GlobalHandle, edit: GlobalHandleEdit, scene: GlobalHandleScene, operationId: string): Float32Array | undefined {
  if (edit.kind === "spine") {
    const spine = regenerateSpine(ctx, scene.graph, edit.owner, edit.graphPatch, operationId, { keepsWelds: edit.carries !== undefined })?.preview;
    if (!spine || !edit.carries?.length) return spine;
    // The floors it carries, where they will stand.
    const moved = new Map(edit.graphPatch.nodes.map((node) => [node.id, node.position]));
    const carried = new Set(edit.carries.map((key) => key.join("\u0000")));
    const segments = [...spine];
    for (const topology of scene.topologies.filter((candidate) => carried.has(candidate.surfaceKey.join("\u0000")))) {
      const at = (id: string) => moved.get(id) ?? topology.nodes.find((node) => node.id === id)!.position;
      for (const use of topology.outerLoops.flat()) {
        const a = at(use.startNodeId), b = at(use.endNodeId);
        segments.push(a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z);
      }
    }
    return Float32Array.from(segments);
  }
  if (edit.kind === "replace") return replacementOutline(edit.request);
  const moved = movedPositions(ctx, handle, edit, scene);
  // Every face the edit moves a node of -- more than the handle's own structure when it carries what is joined to it.
  const nodes = new Set([...handle.nodeIds, ...moved.keys()]);
  const segments: number[] = [];
  for (const topology of scene.topologies) {
    if (!topology.nodes.some((node) => nodes.has(node.id))) continue;
    const standing = new Map(topology.nodes.map((node) => [node.id, node.position]));
    for (const use of [...topology.outerLoops, ...topology.holes].flat()) {
      const a = moved.get(use.startNodeId) ?? standing.get(use.startNodeId), b = moved.get(use.endNodeId) ?? standing.get(use.endNodeId);
      if (a && b) segments.push(a.x, a.y + 0.05, a.z, b.x, b.y + 0.05, b.z);
    }
  }
  return Float32Array.from(segments);
}

type RegionPart = Extract<GlobalHandleEdit, { kind: "region-part" }>;
type Placed = Extract<GlobalHandleEdit, { kind: "vertices" }>;

/**
 * A push that would reshape a weld -- a floor widened along a ramp's end, a
 * ramp's welded end widened -- is made with the weld paused: the end comes
 * off, the pushed structure alone is reshaped, and the end is welded back
 * wherever it then lies (`orchestration/weld-pause.ts`). The other structure
 * is left exactly as it was.
 */
interface PausedWelds {
  readonly part: RegionPart;
  readonly links: readonly WeldLink[];
}

/** Thrown by {@link resolvedPart} when the push can only be made with these welds paused. */
class NeedsPause extends Error {
  readonly links: readonly WeldLink[];
  constructor(links: readonly WeldLink[]) {
    super("A solda precisa ser pausada.");
    this.links = links;
  }
}


/** `ops` as the nodes they place and the edges they retype, every curved edge they move an end of carried along. */
function placedBy(ops: readonly AtomicEditOp[], topologies: GlobalHandleScene["topologies"]): Placed {
  const moves: { nodeId: string; position: ConstructionPosition }[] = [];
  const retypes: { edgeId: string; geometry: ConstructionEdgeGeometry }[] = [];
  for (const op of ops) {
    if (op.kind === "move-vertex") moves.push({ nodeId: op.nodeId, position: op.position });
    else if (op.kind === "retype-edge") retypes.push({ edgeId: op.edgeId, geometry: op.geometry });
    else throw new Error(`Um lado ou canto não faz ${op.kind}.`);
  }
  const retyped = new Set(retypes.map((retype) => retype.edgeId));
  for (const follow of arcsFollowing(topologies, new Map(moves.map((move) => [move.nodeId, move.position])))) {
    if (!retyped.has(follow.edgeId)) retypes.push({ edgeId: follow.edgeId, geometry: follow.geometry });
  }
  return { kind: "vertices", moves, retypes };
}

const opsOf = (placed: Placed): AtomicEditOp[] => [
  ...placed.moves.map((move) => ({ kind: "move-vertex" as const, nodeId: move.nodeId, position: move.position })),
  ...placed.retypes.map((retype) => ({ kind: "retype-edge" as const, edgeId: retype.edgeId, geometry: retype.geometry })),
];

/**
 * A side or corner push carried out the way grabbing that part would be --
 * through the type's own role for it, rigid carry and all -- as the nodes it
 * places. Planned from the table as it stood when the gesture began, so each
 * move re-plans the whole push. One that would reshape a weld pauses it.
 */
function resolvedPart(ctx: ToolContext, edit: GlobalHandleEdit, scene: GlobalHandleScene): GlobalHandleEdit {
  if (edit.kind !== "region-part") return edit;
  const cloud = resolveCloudTopology(ctx.runtime, edit.seed);
  if (!cloud) throw new Error("A estrutura não está mais aqui.");
  const gesture = { surfaceKey: edit.seed, target: edit.target, delta: edit.delta };
  const face = scene.topologies.find((topology) => surfaceKeyText(topology.surfaceKey) === surfaceKeyText(edit.seed));
  const preserveJoined = face !== undefined && resolvePolicy(face, edit.target).preserveJoined === true;
  const links = face ? endJoinsOf(scene.graph, scene.topologies, face) : [];
  const positions = new Map(scene.graph.nodes.map((node) => [node.id, node.position]));
  const plan = planEdit(cloud, gesture, scene.graph, ctx.runtime);
  if (plan.kind === "apply") {
    const placed = placedBy(plan.ops, scene.topologies);
    // A floor pushed never takes a joined structure along, not even whole: any join whose nodes it would move is paused.
    const reshaped = reshapedWelds(links, positions, new Map(placed.moves.map((move) => [move.nodeId, move.position])), face !== undefined && hasTrait(face.surfaceType, "floor"));
    if (reshaped.length > 0 && !preserveJoined) throw new NeedsPause(reshaped);
    // Held still by what it is joined to -- a solid floor walking its end's edge: paused, and planned again.
    const pushes = Math.hypot(edit.delta.x, edit.delta.y, edit.delta.z) > 1e-9;
    if (pushes && placed.moves.length === 0 && links.length > 0 && !preserveJoined) throw new NeedsPause(links);
    return placed;
  }
  // Refused as welded: every weld the structure takes part in is paused, and the push planned again.
  if (links.length > 0) throw new NeedsPause(links);
  throw new Error(plan.reason);
}

/** `part`'s target on the table as it now stands: the same corner, or the edge now running through the same side's middle. */
function targetNow(ctx: ToolContext, part: RegionPart, was: GlobalHandleScene): RegionPart["target"] {
  const face = ctx.runtime.getAllRegionTopologies().find((topology) => surfaceKeyText(topology.surfaceKey) === surfaceKeyText(part.seed));
  if (!face) throw new Error("A estrutura não está mais aqui.");
  const at = new Map(face.nodes.map((node) => [node.id, node.position]));
  const before = new Map(was.graph.nodes.map((node) => [node.id, node.position]));
  if (part.target.kind === "vertex") {
    if (at.has(part.target.nodeId)) return part.target;
    const p = before.get(part.target.nodeId)!;
    const same = face.nodes.find((node) => Math.hypot(node.position.x - p.x, node.position.z - p.z) < 1e-6);
    if (!same) throw new Error("O canto não está mais aqui.");
    return { kind: "vertex", nodeId: same.id };
  }
  const edgeId = part.target.edgeId;
  if (face.outerLoops.flat().some((use) => use.edgeId === edgeId)) return part.target;
  const old = was.topologies.flatMap((topology) => topology.outerLoops.flat()).find((use) => use.edgeId === edgeId);
  const a = old && before.get(old.startNodeId), b = old && before.get(old.endNodeId);
  if (!a || !b) throw new Error("O lado não está mais aqui.");
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  const through = face.outerLoops.flat().find((use) => {
    const p = at.get(use.startNodeId)!, q = at.get(use.endNodeId)!;
    const dx = q.x - p.x, dz = q.z - p.z, lengthSq = dx * dx + dz * dz;
    const t = lengthSq < 1e-18 ? 0 : ((mid.x - p.x) * dx + (mid.z - p.z) * dz) / lengthSq;
    return t >= -1e-9 && t <= 1 + 1e-9 && Math.hypot(mid.x - (p.x + dx * t), mid.z - (p.z + dz * t)) < 1e-6;
  });
  if (!through) throw new Error("O lado não está mais aqui.");
  return { kind: "edge", edgeId: through.edgeId };
}

/** Pauses the welds, pushes the part on the table the pause leaves, and welds them back -- one transaction, one undo. */
function commitPaused(ctx: ToolContext, handle: GlobalHandle, paused: PausedWelds, scene: GlobalHandleScene, operationId: string): void {
  let joined = 0;
  const transactionId = `global-handle:${handle.kind}:${ctx.nextSequence()}`;
  const { recorded } = commitStagedRegionEdit(ctx.runtime, {
    before: () => {
      const request = unweld(ctx.runtime.getAllRegionTopologies(), paused.links, `${operationId}:unweld`);
      if (request) ctx.runtime.applyPatchReplacement(request, "local", transactionId);
    },
    ops: () => {
      const cloud = resolveCloudTopology(ctx.runtime, paused.part.seed);
      if (!cloud) throw new Error("A estrutura não está mais aqui.");
      const plan = planEdit(cloud, { surfaceKey: paused.part.seed, target: targetNow(ctx, paused.part, scene), delta: paused.part.delta }, ctx.runtime.getGraphSnapshot(), ctx.runtime);
      if (plan.kind !== "apply") throw new Error(plan.reason);
      return opsOf(placedBy(plan.ops, ctx.runtime.getAllRegionTopologies()));
    },
    after: () => {
      // Welded whole where the end's edge lies along its floor's again.
      const back = reweld(ctx.runtime.getAllRegionTopologies(), paused.links, `${operationId}:reweld`);
      if (back.request) ctx.runtime.applyPatchReplacement(back.request, "local", transactionId);
      // Else each end node the floor has a copy of right there, or a side running through, is shared again.
      const floorsOfLink = (link: WeldLink) => ctx.runtime.getAllRegionTopologies().filter((topology) => link.floors.some((key) => surfaceKeyText(key) === surfaceKeyText(topology.surfaceKey)));
      const rejoined = rejoinNodes(ctx.runtime.getAllRegionTopologies(), paused.links.filter((link) => floorsWeldedBy(floorsOfLink(link), link.rung).length === 0), `${operationId}:rejoin`);
      if (rejoined.request) ctx.runtime.applyPatchReplacement(rejoined.request, "local", transactionId);
      // Neither structure is ever moved to rejoin the other: one the edit took apart stays apart.
      joined = paused.links.filter((link) => floorsOfLink(link).some((floor) => floor.nodes.some((node) => node.id === link.rung.startNodeId || node.id === link.rung.endNodeId))).length;
    },
  }, { transactionId });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId });
  if (joined < paused.links.length) ctx.reportFeedback({ tone: "info", message: "A rampa não está mais na borda da plataforma e ficou solta." });
}

/** Applies `ops` as one transaction, so what the edit reaches -- the ground a grounded platform cuts -- answers with it, and undo takes both back. */
function applyRecorded(ctx: ToolContext, ops: readonly AtomicEditOp[], label: string): void {
  const transactionId = `${label}:${ctx.nextSequence()}`;
  const { recorded } = commitRegionEdit(ctx.runtime, ops, { transactionId });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId });
}

/** The ops `edit` places nodes with, planned on the table as it now stands; `undefined` for an edit that is not a placing of nodes. */
function opsOfEdit(ctx: ToolContext, edit: GlobalHandleEdit, scene: GlobalHandleScene): readonly AtomicEditOp[] | undefined {
  if (edit.kind === "vertices") return opsOf(edit);
  if (edit.kind === "region-part") {
    const placed = resolvedPart(ctx, edit, scene);
    return placed.kind === "vertices" ? opsOf(placed) : undefined;
  }
  if (edit.kind !== "region-move") return undefined;
  const cloud = resolveCloudTopology(ctx.runtime, edit.seed);
  if (!cloud) throw new Error("A estrutura não está mais aqui.");
  const plan = planEdit(cloud, { surfaceKey: edit.seed, target: { kind: "region" }, delta: edit.delta }, scene.graph, ctx.runtime);
  if (plan.kind !== "apply") throw new Error(plan.reason);
  return plan.ops;
}

/**
 * Carries out an edit that lets go of a solid structure, or snapped onto an
 * outline, as one transaction, one undo: the part let go of (`release`), the
 * edit planned on the table that leaves, and everything it placed -- and
 * whatever it snapped onto -- joined to the floor whose outline it now
 * stands on. `false` when the edit is not one placing nodes.
 */
function commitJoining(ctx: ToolContext, handle: GlobalHandle, edit: GlobalHandleEdit, scene: GlobalHandleScene, operationId: string, release: RegionPart | undefined, magnet: readonly string[]): boolean {
  if (!release && edit.kind !== "vertices" && edit.kind !== "region-part" && edit.kind !== "region-move") return false;
  const transactionId = `global-handle:${handle.kind}:${ctx.nextSequence()}`;
  let placed: readonly string[] = [];
  const { recorded } = commitStagedRegionEdit(ctx.runtime, {
    before: () => {
      if (!release) return;
      const request = releasePart(ctx.runtime.getAllRegionTopologies(), ctx.runtime.getGraphSnapshot(), release, `${operationId}:release`);
      if (request) ctx.runtime.applyPatchReplacement(request, "local", transactionId);
    },
    ops: () => {
      let ops: readonly AtomicEditOp[] | undefined;
      if (release) {
        const cloud = resolveCloudTopology(ctx.runtime, release.seed);
        if (!cloud) throw new Error("A estrutura não está mais aqui.");
        const plan = planEdit(cloud, { surfaceKey: release.seed, target: targetNow(ctx, release, scene), delta: release.delta }, ctx.runtime.getGraphSnapshot(), ctx.runtime);
        if (plan.kind !== "apply") throw new Error(plan.reason);
        ops = opsOf(placedBy(plan.ops, ctx.runtime.getAllRegionTopologies()));
      } else ops = opsOfEdit(ctx, edit, scene)!;
      placed = ops.flatMap((op) => (op.kind === "move-vertex" ? [op.nodeId] : []));
      return ops;
    },
    after: () => {
      const joined = joinWhereLanded(ctx.runtime.getAllRegionTopologies(), [...placed, ...magnet], `${operationId}:join`);
      if (joined) ctx.runtime.applyPatchReplacement(joined, "local", transactionId);
    },
  }, { transactionId });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId });
  return true;
}

/** Carries out `edit`: a spine regenerated by its owner, a cloud moved through its own role, or placed nodes. */
function commitEdit(ctx: ToolContext, handle: GlobalHandle, edit: GlobalHandleEdit, scene: GlobalHandleScene, operationId: string): void {
  if (edit.kind === "spine") {
    const regenerated = regenerateSpine(ctx, scene.graph, edit.owner, edit.graphPatch, operationId, { keepsWelds: edit.carries !== undefined });
    if (regenerated) commitSpineRegeneration(ctx, regenerated.request, operationId, edit.carries);
    return;
  }
  if (edit.kind === "replace") {
    const faceProps = edit.faceProps;
    // What was pinned to the faces replaced -- a window in a gable -- is pinned to their successors.
    const pinned = faceProps && pinnedToRoles(scene.topologies, edit.request.sourceSurfaceKeys);
    const { recorded } = commitPatchReplacement(ctx.runtime, edit.request, {
      transactionId: operationId,
      ...(faceProps ? { afterward: (outcome) => keepFaceProps(ctx.runtime, operationId, outcome.createdSurfaceKeys, faceProps, pinned) } : {}),
    });
    if (recorded) ctx.history.record({ kind: "transaction", transactionId: operationId });
    return;
  }
  if (edit.kind === "region-part") {
    commitEdit(ctx, handle, resolvedPart(ctx, edit, scene), scene, operationId);
    return;
  }

  if (edit.kind === "region-move") {
    const cloud = resolveCloudTopology(ctx.runtime, edit.seed);
    if (!cloud) return;
    const plan = planEdit(cloud, { surfaceKey: edit.seed, target: { kind: "region" }, delta: edit.delta }, scene.graph, ctx.runtime);
    if (plan.kind !== "apply") throw new Error(plan.reason);
    applyRecorded(ctx, plan.ops, `global-handle:${handle.kind}`);
    return;
  }
  applyRecorded(ctx, [
    ...edit.moves.map((move) => ({ kind: "move-vertex" as const, nodeId: move.nodeId, position: move.position })),
    ...edit.retypes.map((retype) => ({ kind: "retype-edge" as const, edgeId: retype.edgeId, geometry: retype.geometry })),
  ], `global-handle:${handle.kind}`);
}

/**
 * Drags any global handle of any structure (`global-handles/`). The gesture
 * only turns the pointer into an intent -- a move, a turn round the pivot, a
 * height, a winding -- and asks the handle's provider what it edits.
 *
 * The handle stays on its own path while dragged -- its `HandleMotion`,
 * through `constrained-drag.ts` -- never loose under the pointer, and the
 * structure is previewed as the edit would leave it. The motion gives the
 * path; the handle's kind gives what the path means.
 */
export function beginGlobalHandleGesture(ctx: ToolContext, sample: PointerSample, ownsType: (surfaceType: string) => boolean, params?: CurveGestureOptions): CurveGesture | undefined {
  let scene = sceneOf(ctx);
  /** The table before a pause, and the pause itself -- while a push that reshapes a weld is dragged, the weld stands paused so the preview is the real thing. */
  let pause: { readonly transactionId: string; readonly was: GlobalHandleScene; readonly links: readonly WeldLink[] } | undefined;
  let pausedPart: RegionPart | undefined;
  /** The table before a part was let go of a solid structure for the drag, and that letting go. */
  let released: { readonly transactionId: string; readonly was: GlobalHandleScene } | undefined;
  const resume = () => {
    for (const held of [pause, released]) {
      if (!held) continue;
      ctx.runtime.undoTransaction(held.transactionId, "local");
      scene = held.was;
    }
    pause = undefined;
    released = undefined;
  };
  const handle = sample.nodeId ? shownGlobalHandleAt(scene, sample.nodeId) : undefined;
  if (!handle || !ownsType(handle.owner)) return undefined;
  const operationId = `global-${handle.kind}:${ctx.nextSequence()}`;
  const drag = createConstrainedDrag(handle.motion, handle.position, sample, {
    spatialTarget: params?.spatialTarget, elevation: params?.mode === "elevation", pointerOrigin: params?.pointerOrigin,
  });
  let edit: GlobalHandleEdit | undefined;
  let ended = false;
  const ruler = rulerOf(ctx);
  // Snapping onto the other structures' outlines, as they stood when the drag began -- never while lifting.
  const snap = handle.snaps === true && handle.faces !== undefined && params?.mode !== "elevation"
    ? { anchors: snapAnchorsOf(scene, handle), links: snapLinksOf(scene, handle) }
    : undefined;
  // Lifting lands on the heights other structures stand at -- the ruler's levels -- whatever lifts: a top, a ridge, an end.
  const lifting = handle.faces !== undefined && (handle.motion.kind === "vertical" || params?.mode === "elevation") ? snapLinksOf(scene, handle) : undefined;
  let snapped: OutlineSnap | undefined;
  // The height the structure rises from, as it stood when the drag began: the lowest of its nodes.
  const base = ruler.base(
    (handle.faces ? scene.topologies.filter((topology) => handle.faces!.includes(faceKey(topology))).flatMap((topology) => topology.nodes.map((node) => node.position.y)) : scene.graph.nodes.filter((node) => handle.nodeIds.includes(node.id)).map((node) => node.position.y)),
    handle.pivot.y,
  );
  /** What this kind of handle measures: declared with the kind, so no gesture carries its own list. */
  const measurement = HANDLE_MEASUREMENT[handle.kind];
  /** What it is read against, declared the same way: where it was grabbed, the sides it edits, the runs beside it, or nothing. */
  const reference = HANDLE_REFERENCE[handle.kind];
  // The sides it edits are read from their far ends -- which stay -- never from where the vertex began, which is gone as soon as it moves.
  // Taken as the structure stood when the drag began.
  const neighbours = reference === "edges" || reference === "grade" ? editNeighbours(scene.topologies, handle) : undefined;
  const edgeLinks = reference === "edges" && neighbours && neighbours.fixed.length > 0 ? snap?.links ?? ruler.linksWithout(new Set(handle.faces ?? [])) : undefined;
  /** A handle that turns about a centre: its orbit. */
  const orbit = handle.motion.kind === "orbit" ? handle.motion : undefined;
  /** The guides the ruler is drawing for the drag now. */
  let guidesNow: readonly RulerGuide[] = [];

  /** Where the handle stands on its path, what that asks of the structure, and what it measures. */
  function intentOf(gesture: ToolGesture): { readonly intent: GlobalHandleIntent; readonly at: ConstructionPosition; readonly measures: readonly RulerMeasure[] } {
    const raw = drag.at(gesture);
    // A turn lands on a step of the protractor -- the table's, or the finer one with Shift -- and the handle is drawn where it landed.
    const radius = orbit ? Math.hypot(handle!.position.x - orbit.center.x, handle!.position.z - orbit.center.z) : 0;
    const turn = orbit ? ruler.turn(raw.angle ?? 0, radius) : undefined;
    const angle = turn ? turn.angle : raw.angle ?? 0;
    const dragged = orbit && turn?.turns !== undefined ? rotateInPlan(handle!.position, orbit.center, angle) : raw.position;
    // Read where the structure stands -- its pivot -- not where the handle is drawn, which stands off it.
    const standing = handle!.pivot.y + (dragged.y - handle!.position.y);
    const lifted = ruler.lift({ dragged, standing, base, ...(lifting ? { links: lifting } : {}), rounds: measurement === "height" && (handle!.motion.kind === "vertical" || params?.mode === "elevation") });
    const free = { ...dragged, y: lifted.y };
    snapped = snap ? ruler.drag(snap.anchors, { x: free.x - handle!.position.x, y: free.y - handle!.position.y, z: free.z - handle!.position.z }, handle!.motion, snap.links) : undefined;
    let at = snapped ? { x: handle!.position.x + snapped.delta.x, y: handle!.position.y + snapped.delta.y, z: handle!.position.z + snapped.delta.z } : free;
    const direction = handle!.motion.kind === "line" ? handle!.motion.direction : { x: 0, z: 0 };
    // Measured where the structure stands -- its pivot -- not where the handle is drawn.
    const pivot = handle!.pivot;
    const standingAt = (position: { readonly x: number; readonly y: number; readonly z: number }) => ({ x: pivot.x + position.x - handle!.position.x, y: pivot.y + position.y - handle!.position.y, z: pivot.z + position.z - handle!.position.z });
    let made: readonly RulerMeasure[];
    let edgeGuides: readonly RulerGuide[] = [];
    if (edgeLinks && neighbours) {
      // The vertex against the sides it edits: ruled from their fixed ends to where it now stands, unless something already joined it.
      const ruled = ruler.edge({ at: standingAt(at), fixed: neighbours.fixed, own: neighbours.own, links: edgeLinks, rule: !snapped?.joins });
      at = { x: handle!.position.x + ruled.position.x - pivot.x, y: at.y, z: handle!.position.z + ruled.position.z - pivot.z };
      made = ruled.measures;
      edgeGuides = ruled.guides;
    } else if (reference === "grade" && neighbours) {
      // A top against the runs beside it: how high it stands, and how steeply each run climbs to it.
      made = [...ruler.measure(ruler.named(measurement === "none" ? "height" : measurement, { direction, base, angle }), pivot, standingAt(at)), ...ruler.grades(standingAt(at), neighbours.fixed)];
    } else {
      made = measurement === "none" ? [] : ruler.measure(ruler.named(measurement, { direction, base, angle }), pivot, standingAt(at));
    }
    const delta = { x: at.x - handle!.position.x, y: at.y - handle!.position.y, z: at.z - handle!.position.z };
    // A turn is drawn round its centre: the line out to the handle, and the protractor from where it began.
    const turning: { guides: RulerGuide[]; measures: RulerMeasure[] } = { guides: [], measures: [] };
    if (orbit) {
      const centre = { x: orbit.center.x, y: handle!.position.y, z: orbit.center.z };
      const start = Math.atan2(handle!.position.z - orbit.center.z, handle!.position.x - orbit.center.x);
      turning.guides.push({ kind: "polar", origin: centre, to: at, degrees: (((angle * 180) / Math.PI) % 360 + 360) % 360, from: "start", zero: start });
      turning.measures.push({ kind: "length", from: centre, to: at, meters: radius });
    }
    // What the ruler caught shows whether or not the snap took it.
    guidesNow = [...lifted.guides, ...turning.guides, ...(snapped?.guides ?? []), ...edgeGuides];
    const measures = [...made, ...turning.measures, ...(snapped?.measures ?? [])];
    switch (handle!.kind) {
      case "pivot":
      case "corner":
      case "foot":
      case "top":
      case "side":
      case "insert":
        return { intent: { kind: "move", delta }, at, measures };
      case "detach": return { intent: { kind: "detach" }, at, measures };
      case "rise":
      case "height":
      case "slope":
      case "seam":
        return { intent: { kind: "height", dy: delta.y }, at, measures };
      case "rotate": return { intent: { kind: "rotate", angle }, at, measures };
      case "turns": return { intent: { kind: "wind", angle }, at, measures };
      case "radius": {
        const push = delta.x * direction.x + delta.z * direction.z;
        return { intent: { kind: "radius", delta: push }, at, measures };
      }
      case "originHeight":
      case "destinationHeight":
        return { intent: { kind: "lift", dy: delta.y }, at, measures };
      case "origin":
      case "destination": {
        const under = floorUnder(floorsOf(ctx), gesture.current)?.surfaceKey;
        return { intent: { kind: "place", at, ...(under ? { under } : {}) }, at, measures };
      }
    }
  }

  return {
    move(gesture) {
      if (ended) return;
      if (params?.dragThreshold && sample.screenX !== undefined && gesture.current.screenX !== undefined && sample.screenY !== undefined && gesture.current.screenY !== undefined
        && Math.hypot(gesture.current.screenX - sample.screenX, gesture.current.screenY - sample.screenY) < params.dragThreshold) return;
      try {
        const { intent, at, measures } = intentOf(gesture);
        ruler.show({ guides: guidesNow, measures });
        ctx.runtime.previewNodeHandle?.(handle.id, at);
        const planned = planGlobalHandle((pause ?? released)?.was ?? scene, handle, intent, ctx.runtime, operationId);
        if (planned?.kind === "region-part") {
          pausedPart = planned;
          // A part held with a solid structure slides off it: let go for the drag, so the preview is the real thing.
          if (!pause && !released) {
            const transactionId = `${operationId}:release`;
            const source = scene.topologies.find((topology) => surfaceKeyText(topology.surfaceKey) === surfaceKeyText(planned.seed));
            const keepJoined = source !== undefined && resolvePolicy(source, planned.target).preserveJoined === true;
            const request = keepJoined ? undefined : releasePart(scene.topologies, scene.graph, planned, transactionId);
            if (request) {
              ctx.runtime.transact(transactionId, "local", () => ctx.runtime.applyPatchReplacement(request, "local", transactionId));
              released = { transactionId, was: scene };
              scene = sceneOf(ctx);
            }
          }
          // Once paused or let go, the push is planned on the table that leaves, its target found there again.
          const was = (pause ?? released)?.was;
          const part = was ? { ...planned, target: targetNow(ctx, planned, was) } : planned;
          try {
            edit = resolvedPart(ctx, part, scene);
          } catch (error) {
            if (!(error instanceof NeedsPause) || pause || released) throw error;
            const transactionId = `${operationId}:pause`;
            const request = unweld(scene.topologies, error.links, transactionId);
            if (!request) throw error;
            ctx.runtime.transact(transactionId, "local", () => ctx.runtime.applyPatchReplacement(request, "local", transactionId));
            pause = { transactionId, was: scene, links: error.links };
            scene = sceneOf(ctx);
            edit = resolvedPart(ctx, { ...planned, target: targetNow(ctx, planned, pause.was) }, scene);
          }
        } else {
          edit = planned && resolvedPart(ctx, planned, scene);
        }
        const preview = edit && previewOf(ctx, handle, edit, scene, operationId);
        if (preview) ctx.runtime.showPreview({ kind: "segments", positions: preview, color: PREVIEW_COLOR, opacity: 0.9 }, CHANNEL);
      } catch (error) {
        edit = undefined;
        ctx.runtime.clearPreview(CHANNEL);
        ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    commit() {
      if (ended) return;
      ended = true;
      ctx.runtime.clearPreview(CHANNEL);
      ctx.runtime.previewNodeHandle?.(handle.id, undefined);
      const paused = pause && pausedPart ? { part: pausedPart, links: pause.links } : undefined;
      const release = released ? pausedPart : undefined;
      resume();
      // A handle that is clicked, not dragged, acts on release.
      if (handle.motion.kind === "fixed") {
        try { edit = planGlobalHandle(scene, handle, intentOf({ start: sample, current: sample, samples: [sample] }).intent, ctx.runtime, operationId); }
        catch (error) { ctx.reportFeedback({ tone: "error", message: error instanceof Error ? error.message : String(error) }); return; }
      }
      if (!edit) return;
      try {
        if (paused) commitPaused(ctx, handle, paused, scene, operationId);
        else if (!((release || snapped?.joins) && commitJoining(ctx, handle, edit, scene, operationId, release, snapped?.magnet ?? []))) commitEdit(ctx, handle, edit, scene, operationId);
        // Named after a node the edit keeps, so the same id finds it where it now stands.
        const moved = shownGlobalHandleAt(sceneOf(ctx), handle.id);
        ctx.reportSelection(moved ? { id: moved.id, point: moved.position } : undefined);
        ctx.reportFeedback({ tone: "success", message: HANDLE_DONE[handle.kind] });
      } catch (error) {
        ctx.reportFeedback({ tone: "error", message: `Estrutura preservada: ${error instanceof Error ? error.message : String(error)}` });
      }
    },
    cancel() {
      ended = true;
      resume();
      ctx.runtime.clearPreview(CHANNEL);
      ctx.runtime.previewNodeHandle?.(handle.id, undefined);
    },
  };
}
