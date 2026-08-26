import type {
  ConstructionGraphSnapshot,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

import { isSpineControlNodeId } from "../structure-types/path/spine-graph/spine-node-id.ts";

/**
 * The cloud: the connected component of same-`type` surfaces reachable from
 * one of them by shared graph nodes.
 *
 * `ADR-0022` puts this fourth in the layering (graph -> mesh -> surface ->
 * **cloud** -> asset) and is explicit about what it is for: "this is the
 * unit generation and editing operate on -- never an individual `Surface` in
 * isolation," and "editing dispatches by cloud, not by individual surface."
 * A cloud of one surface is not a special case; it is a component of size
 * one, same code path as one of a thousand.
 *
 * Derived, never stored, exactly like a mesh. There is no cloud object in
 * the graph to keep in sync: two separately drawn walls become one cloud the
 * moment a stroke welds a node they both reference, because the *next*
 * query walks across it. Nothing performs a merge, and nothing can forget
 * to.
 *
 * The type is what the cloud carries, and the reason the whole layer exists:
 * a surface holds the `type` string, but the cloud is the thing that string
 * names as one construction. Which is why a type's editing behaviour is
 * declared against the cloud (`structure-types/`), and why a tool preset --
 * "a tower," "a house" -- can only choose parameters and a generator, never
 * hold behaviour of its own.
 */
export interface ConstructionCloud {
  /** The one type every member shares; a cloud never spans two. */
  readonly surfaceType: string;
  /** The member the gesture actually landed on. */
  readonly seed: ConstructionSurfaceKey;
  /** Every member, the seed included, in the engine's own stable order. */
  readonly members: readonly ConstructionSurfaceKey[];
}

/**
 * The slice of the runtime a cloud resolution needs, named here so
 * `features/` stays free of the composition root and a test can supply two
 * functions instead of a runtime.
 */
export interface CloudSource {
  cloudFor(request: {
    readonly seed: ConstructionSurfaceKey;
    readonly surfaceType: string;
  }): { readonly surfaceKeys: readonly ConstructionSurfaceKey[] };
  getRegionTopology(surfaceKey: ConstructionSurfaceKey): ConstructionRegionTopology | undefined;
}

/** A cloud together with the live boundary of every member. */
export interface CloudTopology {
  readonly cloud: ConstructionCloud;
  /**
   * The member the gesture landed on. Role resolution reads this one and
   * only this one: a corner is a corner of the face it belongs to, and
   * asking the whole cloud what a single grabbed node means would have no
   * answer.
   */
  readonly seed: ConstructionRegionTopology;
  /** Every member's boundary, the seed included. */
  readonly members: readonly ConstructionRegionTopology[];
}

function sameKey(left: ConstructionSurfaceKey, right: ConstructionSurfaceKey): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * The cloud the surface at `seed` belongs to.
 *
 * The engine answers which surfaces are connected and share the type; it is
 * never asked what the type *means*. `undefined` only when the key is stale
 * -- a live surface always belongs to at least its own cloud, so an empty
 * membership is treated as the seed alone rather than as an error, which is
 * what keeps a component of size one on the same path as any other.
 */
export function resolveCloud(
  source: CloudSource,
  seed: ConstructionSurfaceKey,
): ConstructionCloud | undefined {
  const topology = source.getRegionTopology(seed);
  if (topology === undefined) return undefined;
  const surfaceType = topology.surfaceType;
  const reported = source.cloudFor({ seed, surfaceType }).surfaceKeys;
  const members = reported.some((key) => sameKey(key, seed)) ? reported : [seed, ...reported];
  return { surfaceType, seed, members };
}

/**
 * {@link resolveCloud} plus every member's live boundary, which is what a
 * gesture is actually planned against.
 *
 * A member whose topology has since gone stale is dropped rather than
 * failing the whole resolution: the cloud query and the topology reads are
 * separate calls, and a surface that disappeared between them is exactly the
 * case where continuing with what is still there is right.
 */
export function resolveCloudTopology(
  source: CloudSource,
  seed: ConstructionSurfaceKey,
): CloudTopology | undefined {
  const cloud = resolveCloud(source, seed);
  if (cloud === undefined) return undefined;
  const members = cloud.members
    .map((key) => source.getRegionTopology(key))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  const seedTopology = members.find((topology) => sameKey(topology.surfaceKey, seed));
  if (seedTopology === undefined) return undefined;
  return { cloud, seed: seedTopology, members };
}

/**
 * Re-reads every member's boundary against the live session, keeping the
 * membership already resolved.
 *
 * A drag re-plans on every tick and must see current positions, but must not
 * re-resolve membership mid-gesture: a move that welds onto a neighbour
 * would silently enlarge the cloud under the pointer and start dragging
 * geometry the gesture never grabbed. Membership is settled once, on press.
 */
export function refreshCloudTopology(
  source: CloudSource,
  cloud: ConstructionCloud,
): CloudTopology | undefined {
  const members = cloud.members
    .map((key) => source.getRegionTopology(key))
    .filter((topology): topology is ConstructionRegionTopology => topology !== undefined);
  const seedTopology = members.find((topology) => sameKey(topology.surfaceKey, cloud.seed));
  if (seedTopology === undefined) return undefined;
  return { cloud, seed: seedTopology, members };
}

/** Every distinct boundary node across a cloud, deduplicated by id -- members share nodes wherever they are welded. */
export function cloudNodes(
  topology: CloudTopology,
  graphSnapshot?: ConstructionGraphSnapshot,
): readonly { readonly id: string; readonly position: { readonly x: number; readonly y: number; readonly z: number } }[] {
  const byId = new Map<string, { readonly id: string; readonly position: { readonly x: number; readonly y: number; readonly z: number } }>();
  for (const member of topology.members) {
    for (const node of member.nodes) {
      if (!byId.has(node.id)) byId.set(node.id, node);
    }
  }
  if (graphSnapshot !== undefined && topology.cloud.surfaceType === "path") {
    for (const node of graphSnapshot.nodes) {
      if (isSpineControlNodeId(node.id) && !byId.has(node.id)) {
        byId.set(node.id, node);
      }
    }
  }
  return [...byId.values()];
}
