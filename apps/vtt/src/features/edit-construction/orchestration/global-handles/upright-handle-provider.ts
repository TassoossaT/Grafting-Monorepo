import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { globalHandleId } from "../../global-handles/index.ts";
import type { GlobalHandle, GlobalHandleProvider, GlobalHandleScene } from "../../global-handles/index.ts";
import { resolvePolicy, structureTypeFor } from "../../structure-types/index.ts";
import type { EditTarget } from "../atomic-edit.ts";
import { handleNodeName } from "./handle-name.ts";
import { faceKey } from "../../topology/plan-geometry.ts";

/**
 * Handles of structures standing upright -- faces rising from a foot run to
 * a top run by posts, a wall -- read from their shape, not their type:
 *
 * - foot: at each post's foot, stood off the face -- moves where the post
 *   stands, its top following by the type's own law;
 * - top: just above each post's top -- only how high that side rises;
 * - side: off the middle of each run -- drags the run across, square to it.
 *
 * A face has two sides, so each handle standing off it comes once per side,
 * facing that way; the scene shows only the one facing the viewer. Which
 * parts get a handle is the type's own `partHandle`; dragging one edits the
 * part through the type's own role for it.
 */

/** How far off the face a foot or side handle stands. */
const OFF_FACE = 0.45;
/** How far above a post's top its height handle stands. */
const ABOVE_TOP = 0.35;


/** An upright handle: the generic handle, with the face and the part it edits. */
export interface UprightGlobalHandle extends GlobalHandle {
  readonly seed: ConstructionRegionTopology;
  readonly target: Extract<EditTarget, { kind: "edge" } | { kind: "vertex" }>;
}

/**
 * The posts of an upright face: edges rising more than half the face's own
 * height, and steeply -- far more up than across -- each as its foot and top.
 * A sloped face (a ramp) has none; a leaning post is still found.
 */
export function uprightPosts(topology: ConstructionRegionTopology): readonly { readonly foot: string; readonly top: string }[] {
  const at = new Map(topology.nodes.map((node) => [node.id, node.position]));
  const ys = topology.nodes.map((node) => node.position.y);
  const half = (Math.max(...ys) - Math.min(...ys)) / 2;
  if (!(half > 1e-4)) return [];
  return topology.outerLoops.flat().flatMap((use) => {
    const a = at.get(use.startNodeId)!, b = at.get(use.endNodeId)!;
    const rise = Math.abs(a.y - b.y);
    if (rise <= half || Math.hypot(a.x - b.x, a.z - b.z) > rise / 2) return [];
    return [a.y < b.y ? { foot: use.startNodeId, top: use.endNodeId } : { foot: use.endNodeId, top: use.startNodeId }];
  });
}

/** Whether `topology` stands upright. */
export const isUpright = (topology: ConstructionRegionTopology) => uprightPosts(topology).length > 0;

export const uprightHandleProvider: GlobalHandleProvider = {
  name: "upright",
  handles(scene) {
    const candidates = scene.topologies.filter((topology) => {
      const type = structureTypeFor(topology.surfaceType);
      return type?.partHandle !== undefined && type.spine === undefined && isUpright(topology);
    });
    const byKey = new Map(candidates.map((topology) => [faceKey(topology), topology]));
    const placed = new Set<string>();
    const handles: UprightGlobalHandle[] = [];
    for (const topology of candidates) {
      if (placed.has(faceKey(topology))) continue;
      const members = [topology, ...scene.cloudFor({ seed: topology.surfaceKey, surfaceType: topology.surfaceType }).surfaceKeys
        .map((key) => byKey.get(key.join("\u0000")))
        .filter((member): member is ConstructionRegionTopology => member !== undefined && member !== topology)];
      for (const member of members) placed.add(faceKey(member));
      const nodeIds = [...new Set(members.flatMap((member) => member.nodes.map((node) => node.id)))].sort();
      const { name } = handleNodeName(scene, members, nodeIds);
      const faces = members.map(faceKey);
      const seen = new Set<string>();
      for (const member of members) {
        const type = structureTypeFor(member.surfaceType)!;
        const declares = (kind: "foot" | "top" | "side", target: UprightGlobalHandle["target"]) =>
          type.globalHandles?.includes(kind) === true && type.partHandle!(resolvePolicy(member, target).role);
        const at = new Map(member.nodes.map((node) => [node.id, node.position]));
        const posts = uprightPosts(member);
        const feet = new Set(posts.map((post) => post.foot));
        // The face's two sides, from its foot run: square to it, each way.
        const run = member.outerLoops.flat().find((use) => feet.has(use.startNodeId) && feet.has(use.endNodeId) && use.startNodeId !== use.endNodeId);
        if (!run) continue;
        const a = at.get(run.startNodeId)!, b = at.get(run.endNodeId)!;
        const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
        const sides = [normal, { x: -normal.x, z: -normal.z }];
        const base = { owner: member.surfaceType, provider: "upright", nodeIds, faces, seed: member };
        const off = (p: ConstructionPosition, n: { x: number; z: number }, up = 0) => ({ x: p.x + n.x * OFF_FACE, y: p.y + up, z: p.z + n.z * OFF_FACE });
        for (const { foot, top } of posts) {
          const f = at.get(foot)!, t = at.get(top)!;
          const footTarget = { kind: "vertex" as const, nodeId: foot };
          for (const [i, n] of sides.entries()) {
            const id = globalHandleId("foot", `${foot}@${name}@${i}`);
            if (seen.has(id) || !declares("foot", footTarget)) continue;
            seen.add(id);
            handles.push({ ...base, id, kind: "foot", target: footTarget, snaps: true, pivot: f, position: off(f, n, 0.05), motion: { kind: "plane" }, facing: n });
          }
          const topTarget = { kind: "vertex" as const, nodeId: top };
          const topId = globalHandleId("top", `${top}@${name}`);
          if (!seen.has(topId) && declares("top", topTarget)) {
            seen.add(topId);
            handles.push({ ...base, id: topId, kind: "top", target: topTarget, pivot: t, position: { ...t, y: t.y + ABOVE_TOP }, motion: { kind: "vertical" } });
          }
        }
        // The foot runs: every edge between two feet.
        for (const use of member.outerLoops.flat()) {
          if (!feet.has(use.startNodeId) || !feet.has(use.endNodeId)) continue;
          const p = at.get(use.startNodeId)!, q = at.get(use.endNodeId)!;
          const tops = posts.filter((post) => post.foot === use.startNodeId || post.foot === use.endNodeId).map((post) => at.get(post.top)!.y);
          const height = (tops.reduce((sum, y) => sum + y, 0) / (tops.length || 1)) - (p.y + q.y) / 2;
          const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, z: (p.z + q.z) / 2 };
          const sideTarget = { kind: "edge" as const, edgeId: use.edgeId };
          for (const [i, n] of sides.entries()) {
            const id = globalHandleId("side", `${use.edgeId}@${name}@${i}`);
            if (seen.has(id) || !declares("side", sideTarget)) continue;
            seen.add(id);
            handles.push({ ...base, id, kind: "side", target: sideTarget, snaps: true, pivot: mid, position: off(mid, n, height / 2), motion: { kind: "line", direction: n }, facing: n });
          }
        }
      }
    }
    return handles;
  },
  plan(_scene: GlobalHandleScene, generic, intent) {
    const handle = generic as UprightGlobalHandle;
    if (intent.kind !== "move") return undefined;
    return { kind: "region-part", seed: handle.seed.surfaceKey, target: handle.target, delta: intent.delta };
  },
};
