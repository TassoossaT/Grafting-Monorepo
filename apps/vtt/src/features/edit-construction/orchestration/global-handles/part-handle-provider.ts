import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { globalHandleId } from "../../global-handles/index.ts";
import type { GlobalHandle, GlobalHandleProvider, GlobalHandleScene } from "../../global-handles/index.ts";
import { resolvePolicy, structureTypeFor } from "../../structure-types/index.ts";
import type { EditTarget } from "../atomic-edit.ts";
import { handleNodeName } from "./handle-name.ts";

/** How far outside a side or a corner its handle stands, so the part itself stays free to build against. */
export const PART_HANDLE_OUT = 0.7;
/** Sides meeting at less than this turn run on as one side, and hold no corner between them. */
const STRAIGHT = 0.05;

/** A side or corner handle: the generic handle, with the face and the part of it the handle pushes. */
export interface PartGlobalHandle extends GlobalHandle {
  readonly seed: ConstructionRegionTopology;
  readonly target: Extract<EditTarget, { kind: "edge" } | { kind: "vertex" }>;
}

type Plan = { readonly x: number; readonly z: number };
const keyOf = (topology: ConstructionRegionTopology) => topology.surfaceKey.join("\u0000");

/** Whether `p` is inside the outline `ring` in plan. */
function inside(ring: readonly Plan[], p: Plan): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** One straight side of a face's outline: its first edge, where it runs, and which way is out. */
interface Side {
  readonly edgeId: string;
  readonly from: ConstructionPosition;
  readonly to: ConstructionPosition;
  readonly out: Plan;
}

/**
 * The straight sides of `topology`'s outer outline that no other face of
 * its own cloud shares -- the outline the cloud shows -- with collinear
 * pieces run together as one side. Curved edges are left to their own
 * curve handles.
 */
function sidesOf(topology: ConstructionRegionTopology, shared: ReadonlySet<string>): readonly (readonly (readonly Side[])[])[] {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  return topology.outerLoops.map((loop) => {
    const ring = loop.map((use) => at.get(use.startNodeId)!);
    const pieces = loop.flatMap((use): Side[] => {
      const from = at.get(use.startNodeId)!, to = at.get(use.endNodeId)!;
      const length = Math.hypot(to.x - from.x, to.z - from.z);
      if (use.geometry.kind === "arc" || length < 1e-6) return [];
      const normal = { x: (to.z - from.z) / length, z: -(to.x - from.x) / length };
      const mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
      const out = inside(ring, { x: mid.x + normal.x * 1e-3, z: mid.z + normal.z * 1e-3 }) ? { x: -normal.x, z: -normal.z } : normal;
      return [{ edgeId: use.edgeId, from, to, out }];
    });
    // Runs of collinear pieces, each kept only where no other face of the cloud shares it.
    const runs: Side[][] = [];
    for (const piece of pieces) {
      const last = runs[runs.length - 1]?.at(-1);
      const straight = last && last.to === piece.from && Math.abs(last.out.x * piece.out.z - last.out.z * piece.out.x) < STRAIGHT && last.out.x * piece.out.x + last.out.z * piece.out.z > 0;
      if (straight) runs[runs.length - 1]!.push(piece); else runs.push([piece]);
    }
    if (runs.length > 1) {
      const first = runs[0]![0]!, last = runs[runs.length - 1]!.at(-1)!;
      if (last.to === first.from && Math.abs(last.out.x * first.out.z - last.out.z * first.out.x) < STRAIGHT && last.out.x * first.out.x + last.out.z * first.out.z > 0) {
        runs[0] = [...runs.pop()!, ...runs[0]!];
      }
    }
    return runs.filter((run) => run.every((piece) => !shared.has(piece.edgeId)));
  });
}

/**
 * A handle just outside each side and each corner of every structure whose
 * type declares `side` or `corner` handles -- for the parts its own
 * `partHandle` names. Dragging one edits that part through the type's own
 * role for it, exactly as grabbing the part itself used to: the platform
 * pushes the side square to itself, a ramp widens. The part itself is never
 * grabbed, so it stays free to build against.
 */
export const partHandleProvider: GlobalHandleProvider = {
  name: "part",
  handles(scene) {
    const candidates = scene.topologies.filter((topology) => {
      const type = structureTypeFor(topology.surfaceType);
      return type?.partHandle !== undefined && type.spine === undefined;
    });
    const byKey = new Map(candidates.map((topology) => [keyOf(topology), topology]));
    const placed = new Set<string>();
    const handles: PartGlobalHandle[] = [];
    for (const topology of candidates) {
      if (placed.has(keyOf(topology))) continue;
      const members = [topology, ...scene.cloudFor({ seed: topology.surfaceKey, surfaceType: topology.surfaceType }).surfaceKeys
        .map((key) => byKey.get(key.join("\u0000")))
        .filter((member): member is ConstructionRegionTopology => member !== undefined && member !== topology)];
      for (const member of members) placed.add(keyOf(member));
      const nodeIds = [...new Set(members.flatMap((member) => member.nodes.map((node) => node.id)))].sort();
      const { name } = handleNodeName(scene, members, nodeIds);
      const faces = members.map(keyOf);
      // An edge two faces of the cloud both hold is inside it, not a side.
      const uses = new Map<string, number>();
      for (const use of members.flatMap((member) => member.outerLoops.flat())) uses.set(use.edgeId, (uses.get(use.edgeId) ?? 0) + 1);
      const shared = new Set([...uses].filter(([, count]) => count > 1).map(([edgeId]) => edgeId));
      for (const member of members) {
        const type = structureTypeFor(member.surfaceType)!;
        const base = { owner: member.surfaceType, provider: "part", nodeIds, faces, seed: member };
        for (const loop of sidesOf(member, shared)) {
          for (const [index, run] of loop.entries()) {
            const from = run[0]!.from, to = run.at(-1)!.to, out = run[0]!.out;
            // The piece holding the side's middle is the one pushed; the type's own rule moves the rest of the side.
            const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, z: (from.z + to.z) / 2 };
            const piece = run.find((candidate) => {
              const d = { x: candidate.to.x - candidate.from.x, z: candidate.to.z - candidate.from.z };
              const t = ((mid.x - candidate.from.x) * d.x + (mid.z - candidate.from.z) * d.z) / (d.x ** 2 + d.z ** 2);
              return t >= -1e-9 && t <= 1 + 1e-9;
            }) ?? run[0]!;
            const side: PartGlobalHandle["target"] = { kind: "edge", edgeId: piece.edgeId };
            if (type.globalHandles?.includes("side") && type.partHandle!(resolvePolicy(member, side).role)) {
              handles.push({ ...base, id: globalHandleId("side", `${piece.edgeId}@${name}`), kind: "side", target: side, pivot: mid,
                position: { x: mid.x + out.x * PART_HANDLE_OUT, y: mid.y, z: mid.z + out.z * PART_HANDLE_OUT }, motion: { kind: "line", direction: out } });
            }
            // The corner where this side ends and the next begins.
            const next = loop[(index + 1) % loop.length];
            if (!next || next === run || next[0]!.from !== to || !type.globalHandles?.includes("corner")) continue;
            const nodeId = member.nodes.find((node) => node.position === to)?.id;
            if (nodeId === undefined) continue;
            const corner: PartGlobalHandle["target"] = { kind: "vertex", nodeId };
            if (!type.partHandle!(resolvePolicy(member, corner).role)) continue;
            const bisector = { x: out.x + next[0]!.out.x, z: out.z + next[0]!.out.z };
            const length = Math.hypot(bisector.x, bisector.z) || 1;
            handles.push({ ...base, id: globalHandleId("corner", `${nodeId}@${name}`), kind: "corner", target: corner, pivot: to,
              position: { x: to.x + (bisector.x / length) * PART_HANDLE_OUT, y: to.y, z: to.z + (bisector.z / length) * PART_HANDLE_OUT }, motion: { kind: "plane" } });
          }
        }
      }
    }
    return handles;
  },
  plan(_scene: GlobalHandleScene, generic, intent) {
    const handle = generic as PartGlobalHandle;
    if (intent.kind !== "move") return undefined;
    return { kind: "region-part", seed: handle.seed.surfaceKey, target: handle.target, delta: intent.delta };
  },
};
