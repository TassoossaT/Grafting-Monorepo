import {
  arcsFollowing,
  floorsWeldedBy,
  shownGlobalHandles,
  structureTypeFor,
  rejoinNodes,
  reshapedWelds,
  reweld,
  unweld,
  weldsOf,
  type WeldLink,
  planEdit,
  planGlobalHandle,
  resolveCloudTopology,
  shownGlobalHandleAt,
  type AtomicEditOp,
  type GlobalHandle,
  type GlobalHandleEdit,
  type GlobalHandleIntent,
  type GlobalHandleKind,
  type GlobalHandleScene,
} from "../../../../features/edit-construction/index.ts";
import type { ApplyPatchReplacementRequest, ConstructionEdgeGeometry, ConstructionPosition } from "../../../../ports/index.ts";
import type { CurveGesture, CurveGestureOptions } from "./curve-edit-gesture.ts";
import { commitSpineRegeneration, regenerateSpine } from "./spine-commit.ts";
import { createConstrainedDrag } from "./constrained-drag.ts";
import { floorsOf, floorUnder } from "./floor-landing.ts";
import { commitPatchReplacement, commitRegionEdit, commitStagedRegionEdit } from "../../effects/effect-commit.ts";
import type { PointerSample, ToolContext, ToolGesture } from "./tool-context.ts";

const CHANNEL = "global-handle";
const PREVIEW_COLOR = 0xffbc55;

/** What each global handle reports once its edit is committed. */
const DONE: Readonly<Record<GlobalHandleKind, string>> = {
  pivot: "Estrutura movida.", rotate: "Estrutura girada.", height: "Altura atualizada.", turns: "Voltas atualizadas.",
  radius: "Raio atualizado.", origin: "Ponta movida.", destination: "Ponta movida.",
  originHeight: "Inclinação atualizada.", destinationHeight: "Inclinação atualizada.",
  side: "Lado ajustado.", corner: "Canto ajustado.",
};

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

const keyOf = (surfaceKey: readonly string[]) => surfaceKey.join("\u0000");

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
  const face = scene.topologies.find((topology) => keyOf(topology.surfaceKey) === keyOf(edit.seed));
  const links = face ? weldsOf(scene.graph, scene.topologies, face) : [];
  const positions = new Map(scene.graph.nodes.map((node) => [node.id, node.position]));
  const plan = planEdit(cloud, gesture, scene.graph, ctx.runtime);
  if (plan.kind === "apply") {
    const placed = placedBy(plan.ops, scene.topologies);
    const reshaped = reshapedWelds(links, positions, new Map(placed.moves.map((move) => [move.nodeId, move.position])));
    if (reshaped.length === 0) return placed;
    throw new NeedsPause(reshaped);
  }
  // Refused as welded: every weld the structure takes part in is paused, and the push planned again.
  if (links.length > 0) throw new NeedsPause(links);
  throw new Error(plan.reason);
}

/** `part`'s target on the table as it now stands: the same corner, or the edge now running through the same side's middle. */
function targetNow(ctx: ToolContext, part: RegionPart, was: GlobalHandleScene): RegionPart["target"] {
  const face = ctx.runtime.getAllRegionTopologies().find((topology) => keyOf(topology.surfaceKey) === keyOf(part.seed));
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

/** How far off its floor's edge a paused end may be left and still follow it there. */
const FOLLOW_REACH = 1.5;

/**
 * Takes a structure end the push left off its floor's edge back onto it --
 * the nearest point of that edge, as dragging the end's own handle there
 * would -- and welds it. `false` when it is welded already, or no edge of
 * that floor is near enough to follow.
 */
function followEnd(ctx: ToolContext, link: WeldLink, operationId: string, transactionId: string): boolean {
  const topologies = ctx.runtime.getAllRegionTopologies();
  const floors = topologies.filter((topology) => link.floors.some((key) => keyOf(key) === keyOf(topology.surfaceKey)));
  if (floors.length === 0 || floorsWeldedBy(floors, link.rung).length > 0) return false;
  const owner = topologies.find((topology) => topology.outerLoops.flat().some((use) => use.edgeId === link.rung.edgeId));
  const end = owner && structureTypeFor(owner.surfaceType)?.ends?.ends(owner).find((candidate) => candidate.rung.edgeId === link.rung.edgeId);
  if (!owner || !end) return false;
  // The nearest point, on an edge of the floor running the way the end does -- never one across it.
  const at = new Map(owner.nodes.map((node) => [node.id, node.position]));
  const a = at.get(link.rung.startNodeId)!, b = at.get(link.rung.endNodeId)!;
  const along = { x: b.x - a.x, z: b.z - a.z };
  const width = Math.hypot(along.x, along.z) || 1;
  let best: { point: ConstructionPosition; distance: number; floor: (typeof floors)[number] } | undefined;
  for (const floor of floors) {
    const positions = new Map(floor.nodes.map((node) => [node.id, node.position]));
    for (const use of floor.outerLoops.flat()) {
      if (use.geometry.kind !== "line") continue;
      const p = positions.get(use.startNodeId)!, q = positions.get(use.endNodeId)!;
      const dx = q.x - p.x, dz = q.z - p.z, length = Math.hypot(dx, dz);
      if (length < 1e-9 || Math.abs(dx * along.z - dz * along.x) / (length * width) > 1e-3) continue;
      const t = Math.max(0, Math.min(1, ((end.position.x - p.x) * dx + (end.position.z - p.z) * dz) / (length * length)));
      const point = { x: p.x + dx * t, y: p.y, z: p.z + dz * t };
      const distance = Math.hypot(point.x - end.position.x, point.z - end.position.z);
      if (distance <= FOLLOW_REACH && (!best || distance < best.distance)) best = { point, distance, floor };
    }
  }
  if (!best) return false;
  const scene = sceneOf(ctx);
  const handle = shownGlobalHandles(scene).find((candidate) => candidate.kind === end.name && candidate.faces?.includes(keyOf(owner.surfaceKey)));
  const edit = handle && planGlobalHandle(scene, handle, { kind: "place", at: best.point, under: best.floor.surfaceKey }, ctx.runtime, operationId);
  if (edit?.kind !== "replace") return false;
  ctx.runtime.applyPatchReplacement(edit.request, "local", transactionId);
  return floorsWeldedBy(ctx.runtime.getAllRegionTopologies().filter((topology) => link.floors.some((key) => keyOf(key) === keyOf(topology.surfaceKey))), link.rung).length > 0;
}

/** Pauses the welds, pushes the part on the table the pause leaves, and welds them back -- one transaction, one undo. */
function commitPaused(ctx: ToolContext, handle: GlobalHandle, paused: PausedWelds, scene: GlobalHandleScene, operationId: string): void {
  let welded = 0;
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
      const back = reweld(ctx.runtime.getAllRegionTopologies(), paused.links, `${operationId}:reweld`);
      if (back.request) ctx.runtime.applyPatchReplacement(back.request, "local", transactionId);
      welded = back.welded;
      // An end node a floor held alone, still standing where the floor's copy of it now is, is shared again.
      const rejoined = rejoinNodes(ctx.runtime.getAllRegionTopologies(), paused.links.filter((link) => !floorsWeldedBy(ctx.runtime.getAllRegionTopologies().filter((topology) => link.floors.some((key) => keyOf(key) === keyOf(topology.surfaceKey))), link.rung).length), `${operationId}:rejoin`);
      if (rejoined.request) ctx.runtime.applyPatchReplacement(rejoined.request, "local", transactionId);
      welded += rejoined.joined > 0 ? paused.links.length - welded : 0;
      if (welded >= paused.links.length) return;
      // An end the push left off its floor's edge follows it there, as its own end handle would take it --
      // only one that was welded whole: one sharing a single corner is never moved to keep it.
      for (const [index, link] of paused.links.entries()) {
        if (!link.welded) continue;
        // One that cannot follow -- its floor's edge now too short for it -- is left off it; the push still stands.
        try { if (followEnd(ctx, link, `${operationId}:follow:${index}`, transactionId)) welded += 1; } catch { /* left off */ }
      }
    },
  }, { transactionId });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId });
  if (welded < paused.links.length) ctx.reportFeedback({ tone: "info", message: "Uma ponta ficou fora da borda e ficou solta." });
}

/** Applies `ops` as one transaction, so what the edit reaches -- the ground a grounded platform cuts -- answers with it, and undo takes both back. */
function applyRecorded(ctx: ToolContext, ops: readonly AtomicEditOp[], label: string): void {
  const transactionId = `${label}:${ctx.nextSequence()}`;
  const { recorded } = commitRegionEdit(ctx.runtime, ops, { transactionId });
  if (recorded) ctx.history.record({ kind: "transaction", transactionId });
}

/** Carries out `edit`: a spine regenerated by its owner, a cloud moved through its own role, or placed nodes. */
function commitEdit(ctx: ToolContext, handle: GlobalHandle, edit: GlobalHandleEdit, scene: GlobalHandleScene, operationId: string): void {
  if (edit.kind === "spine") {
    const regenerated = regenerateSpine(ctx, scene.graph, edit.owner, edit.graphPatch, operationId, { keepsWelds: edit.carries !== undefined });
    if (regenerated) commitSpineRegeneration(ctx, regenerated.request, operationId, edit.carries);
    return;
  }
  if (edit.kind === "replace") {
    const { recorded } = commitPatchReplacement(ctx.runtime, edit.request, { transactionId: operationId });
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
  const resume = () => {
    if (!pause) return;
    ctx.runtime.undoTransaction(pause.transactionId, "local");
    scene = pause.was;
    pause = undefined;
  };
  const handle = sample.nodeId ? shownGlobalHandleAt(scene, sample.nodeId) : undefined;
  if (!handle || !ownsType(handle.owner)) return undefined;
  const operationId = `global-${handle.kind}:${ctx.nextSequence()}`;
  const drag = createConstrainedDrag(handle.motion, handle.position, sample, {
    spatialTarget: params?.spatialTarget, elevation: params?.mode === "elevation", pointerOrigin: params?.pointerOrigin,
  });
  let edit: GlobalHandleEdit | undefined;
  let ended = false;

  /** Where the handle stands on its path, and what that asks of the structure. */
  function intentOf(gesture: ToolGesture): { readonly intent: GlobalHandleIntent; readonly at: ConstructionPosition; readonly readout?: string } {
    const { position: at, angle = 0 } = drag.at(gesture);
    const delta = { x: at.x - handle!.position.x, y: at.y - handle!.position.y, z: at.z - handle!.position.z };
    switch (handle!.kind) {
      case "pivot": return { intent: { kind: "move", delta }, at };
      case "side": return { intent: { kind: "move", delta }, at, readout: `lado ${(delta.x * (handle!.motion.kind === "line" ? handle!.motion.direction.x : 0) + delta.z * (handle!.motion.kind === "line" ? handle!.motion.direction.z : 0)).toFixed(2)} m` };
      case "corner": return { intent: { kind: "move", delta }, at };
      case "height": return { intent: { kind: "height", dy: delta.y }, at, readout: `altura ${delta.y >= 0 ? "+" : ""}${delta.y.toFixed(2)} m` };
      case "rotate": return { intent: { kind: "rotate", angle }, at, readout: `rotação ${((angle * 180) / Math.PI).toFixed(0)}°` };
      case "turns": return { intent: { kind: "wind", angle }, at, readout: `voltas ${angle >= 0 ? "+" : ""}${(angle / (2 * Math.PI)).toFixed(2)}` };
      case "radius": {
        const direction = handle!.motion.kind === "line" ? handle!.motion.direction : { x: 0, z: 0 };
        const push = delta.x * direction.x + delta.z * direction.z;
        return { intent: { kind: "radius", delta: push }, at, readout: `raio ${push >= 0 ? "+" : ""}${push.toFixed(2)} m` };
      }
      case "originHeight":
      case "destinationHeight":
        return { intent: { kind: "lift", dy: delta.y }, at, readout: `ponta ${delta.y >= 0 ? "+" : ""}${delta.y.toFixed(2)} m` };
      case "origin":
      case "destination": {
        const under = floorUnder(floorsOf(ctx), gesture.current)?.surfaceKey;
        return { intent: { kind: "place", at, ...(under ? { under } : {}) }, at };
      }
    }
  }

  return {
    move(gesture) {
      if (ended) return;
      if (params?.dragThreshold && sample.screenX !== undefined && gesture.current.screenX !== undefined && sample.screenY !== undefined && gesture.current.screenY !== undefined
        && Math.hypot(gesture.current.screenX - sample.screenX, gesture.current.screenY - sample.screenY) < params.dragThreshold) return;
      try {
        const { intent, at, readout } = intentOf(gesture);
        ctx.runtime.previewNodeHandle?.(handle.id, at);
        const planned = planGlobalHandle(pause?.was ?? scene, handle, intent, ctx.runtime, operationId);
        if (planned?.kind === "region-part") {
          pausedPart = planned;
          // Once paused, the push is planned on the paused table, its target found there again.
          const part = pause ? { ...planned, target: targetNow(ctx, planned, pause.was) } : planned;
          try {
            edit = resolvedPart(ctx, part, scene);
          } catch (error) {
            if (!(error instanceof NeedsPause) || pause) throw error;
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
        if (readout) ctx.reportFeedback({ tone: "info", message: readout });
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
      resume();
      if (!edit) return;
      try {
        if (paused) commitPaused(ctx, handle, paused, scene, operationId);
        else commitEdit(ctx, handle, edit, scene, operationId);
        // Named after a node the edit keeps, so the same id finds it where it now stands.
        const moved = shownGlobalHandleAt(sceneOf(ctx), handle.id);
        ctx.reportSelection(moved ? { id: moved.id, point: moved.position } : undefined);
        ctx.reportFeedback({ tone: "success", message: DONE[handle.kind] });
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

