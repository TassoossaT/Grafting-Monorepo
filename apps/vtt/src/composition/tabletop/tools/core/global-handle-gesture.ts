import {
  arcsFollowing,
  floorsWeldedBy,
  hasTrait,
  isGroundType,
  isSolidType,
  joinedStructures,
  outlineMagnets,
  rejoinNodes,
  releaseFromSolid,
  snapToOutlines,
  type EditTarget,
  type Magnet,
  type OutlineSnap,
  type SnapAnchor,
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
import { surfaceKeyText } from "../../../../features/edit-construction/index.ts";

const CHANNEL = "global-handle";
const PREVIEW_COLOR = 0xffbc55;

/** What each global handle reports once its edit is committed. */
const DONE: Readonly<Record<GlobalHandleKind, string>> = {
  pivot: "Estrutura movida.", rotate: "Estrutura girada.", height: "Altura atualizada.", turns: "Voltas atualizadas.",
  radius: "Raio atualizado.", origin: "Ponta movida.", destination: "Ponta movida.",
  originHeight: "Inclinação atualizada.", destinationHeight: "Inclinação atualizada.",
  side: "Lado ajustado.", corner: "Canto ajustado.",
  foot: "Coluna movida.", top: "Altura atualizada.", detach: "Estrutura solta.",
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


/** The handles whose drag snaps onto other structures' outlines: those moving a structure, or a part of it, across the plan. */
const SNAPS: ReadonlySet<GlobalHandleKind> = new Set(["pivot", "foot", "side", "corner"]);

/** The nodes of the part a handle drags -- its corner, or its side's two ends. */
function partNodes(topologies: GlobalHandleScene["topologies"], target: EditTarget | undefined): readonly string[] {
  if (target?.kind === "vertex") return [target.nodeId];
  if (target?.kind !== "edge") return [];
  const use = topologies.flatMap((topology) => topology.outerLoops.flat()).find((candidate) => candidate.edgeId === target.edgeId);
  return use ? [use.startNodeId, use.endNodeId] : [];
}

/** What of `handle`'s drag snaps: its part's nodes, or -- dragging the whole -- the lowest of its structure's. */
function snapAnchors(scene: GlobalHandleScene, handle: GlobalHandle): readonly SnapAnchor[] {
  const at = new Map(scene.graph.nodes.map((node) => [node.id, node.position]));
  let ids = partNodes(scene.topologies, (handle as { readonly target?: EditTarget }).target);
  if (ids.length === 0) {
    const low = Math.min(...handle.nodeIds.map((id) => at.get(id)?.y ?? Infinity));
    ids = handle.nodeIds.filter((id) => Math.abs((at.get(id)?.y ?? Infinity) - low) < 0.05);
  }
  return ids.flatMap((id) => { const position = at.get(id); return position ? [{ id, position }] : []; });
}

/** What `handle`'s drag snaps onto: every other structure's outline -- but, dragging the whole, not what goes with it. */
function magnetsFor(scene: GlobalHandleScene, handle: GlobalHandle): readonly Magnet[] {
  const faces = scene.topologies.filter((topology) => handle.faces?.includes(surfaceKeyText(topology.surfaceKey)));
  const moving = handle.kind === "pivot" ? joinedStructures(scene.topologies, faces, isGroundType) : faces;
  return outlineMagnets(scene.topologies, new Set(moving.map((topology) => surfaceKeyText(topology.surfaceKey))), isGroundType);
}

/**
 * A part of a structure that is not solid -- a wall's foot, its foot run --
 * held with a solid one -- the platform it stands on -- is let go of for the
 * drag, so it slides along instead of carrying the solid one whole; where it
 * lands on an outline it is joined again. A structure joined by a weld has
 * its own pause instead. `undefined` when there is nothing to let go.
 */
function releaseFor(topologies: GlobalHandleScene["topologies"], graph: GlobalHandleScene["graph"], part: RegionPart, operationId: string): ApplyPatchReplacementRequest | undefined {
  const face = topologies.find((topology) => surfaceKeyText(topology.surfaceKey) === surfaceKeyText(part.seed));
  if (!face || isSolidType(face.surfaceType) || weldsOf(graph, topologies, face).length > 0) return undefined;
  return releaseFromSolid(topologies, new Set(partNodes(topologies, part.target)), isGroundType, isSolidType, operationId);
}

/**
 * The nodes among `ids` that stand on a floor's outline without being its --
 * joined to it there: the floor passes through them, cut where they stand
 * partway along a side. Nothing is moved to join.
 */
function joinWhereLanded(ctx: ToolContext, ids: readonly string[], operationId: string, transactionId: string): void {
  const topologies = ctx.runtime.getAllRegionTopologies();
  const floors = topologies.filter((topology) => hasTrait(topology.surfaceType, "floor"));
  const onFloor = new Set(floors.flatMap((floor) => floor.nodes.map((node) => node.id)));
  const loose = [...new Set(ids)].filter((id) => !onFloor.has(id));
  if (loose.length === 0) return;
  const links = loose.map((id) => ({ rung: { edgeId: id, startNodeId: id, endNodeId: id }, floors: floors.map((floor) => floor.surfaceKey), welded: false }));
  const joined = rejoinNodes(topologies, links, operationId);
  if (joined.request) ctx.runtime.applyPatchReplacement(joined.request, "local", transactionId);
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
  const links = face ? weldsOf(scene.graph, scene.topologies, face) : [];
  const positions = new Map(scene.graph.nodes.map((node) => [node.id, node.position]));
  const plan = planEdit(cloud, gesture, scene.graph, ctx.runtime);
  if (plan.kind === "apply") {
    const placed = placedBy(plan.ops, scene.topologies);
    // A floor pushed never takes a joined structure along, not even whole: any join whose nodes it would move is paused.
    const reshaped = reshapedWelds(links, positions, new Map(placed.moves.map((move) => [move.nodeId, move.position])), face !== undefined && hasTrait(face.surfaceType, "floor"));
    if (reshaped.length > 0) throw new NeedsPause(reshaped);
    // Held still by what it is joined to -- a solid floor walking its end's edge: paused, and planned again.
    const pushes = Math.hypot(edit.delta.x, edit.delta.y, edit.delta.z) > 1e-9;
    if (pushes && placed.moves.length === 0 && links.length > 0) throw new NeedsPause(links);
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
      const request = releaseFor(ctx.runtime.getAllRegionTopologies(), ctx.runtime.getGraphSnapshot(), release, `${operationId}:release`);
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
    after: () => joinWhereLanded(ctx, [...placed, ...magnet], `${operationId}:join`, transactionId),
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
  // Snapping onto the other structures' outlines, as they stood when the drag began -- never while lifting.
  const snap = SNAPS.has(handle.kind) && handle.faces !== undefined && params?.mode !== "elevation"
    ? { anchors: snapAnchors(scene, handle), magnets: magnetsFor(scene, handle) }
    : undefined;
  let snapped: OutlineSnap | undefined;

  /** Where the handle stands on its path, and what that asks of the structure. */
  function intentOf(gesture: ToolGesture): { readonly intent: GlobalHandleIntent; readonly at: ConstructionPosition; readonly readout?: string } {
    const { position: free, angle = 0 } = drag.at(gesture);
    snapped = snap && snapToOutlines(snap.anchors, { x: free.x - handle!.position.x, y: free.y - handle!.position.y, z: free.z - handle!.position.z }, handle!.motion, snap.magnets);
    const at = snapped ? { x: handle!.position.x + snapped.delta.x, y: handle!.position.y + snapped.delta.y, z: handle!.position.z + snapped.delta.z } : free;
    const delta = { x: at.x - handle!.position.x, y: at.y - handle!.position.y, z: at.z - handle!.position.z };
    switch (handle!.kind) {
      case "pivot": return { intent: { kind: "move", delta }, at };
      case "side": return { intent: { kind: "move", delta }, at, readout: `lado ${(delta.x * (handle!.motion.kind === "line" ? handle!.motion.direction.x : 0) + delta.z * (handle!.motion.kind === "line" ? handle!.motion.direction.z : 0)).toFixed(2)} m` };
      case "corner": return { intent: { kind: "move", delta }, at };
      case "foot": return { intent: { kind: "move", delta }, at };
      case "top": return { intent: { kind: "move", delta }, at, readout: `altura ${delta.y >= 0 ? "+" : ""}${delta.y.toFixed(2)} m` };
      case "detach": return { intent: { kind: "detach" }, at };
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
        const planned = planGlobalHandle((pause ?? released)?.was ?? scene, handle, intent, ctx.runtime, operationId);
        if (planned?.kind === "region-part") {
          pausedPart = planned;
          // A part held with a solid structure slides off it: let go for the drag, so the preview is the real thing.
          if (!pause && !released) {
            const transactionId = `${operationId}:release`;
            const request = releaseFor(scene.topologies, scene.graph, planned, transactionId);
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
        else if (!((release || snapped) && commitJoining(ctx, handle, edit, scene, operationId, release, snapped?.magnet ?? []))) commitEdit(ctx, handle, edit, scene, operationId);
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

