import type {
  ConstructionHostPoint,
  ConstructionNodeId,
  ConstructionOrientedEdgeUse,
  ConstructionPosition,
  ConstructionRegionTopology,
  ConstructionSurfaceKey,
} from "@/ports";

// Relative, not `@/...`: the test runner resolves no aliases, so a module a
// test reaches has to spell out any import it needs at run time. A
// type-only `@/` import is fine -- those are erased.
import { surfaceRefFromNodeSet } from "../../../../entities/map/index.ts";
import { openingStructureType } from "../../../../features/edit-construction/index.ts";

import { boundaryUsage, createBoundaryEdges } from "../core/boundary-edges.ts";
import { scopedToolId, type ToolContext } from "../core/tool-context.ts";
import { commitChange } from "../../effects/effect-commit.ts";
import { shapeChangeOfAddition } from "../../effects/shape-change.ts";

/**
 * What creating, moving, resizing and deleting an opening share. An opening
 * is its own region whose nodes are pinned to a host face in relative
 * `(u, v)`: `u` along the face, `v` a fraction of the local height there.
 * The host has no hole; the engine cuts it at mesh time.
 */

/** How much wall (world units) must be left standing to either side of an opening, and above and below it. */
export const MARGIN = 0.15;

/** An axis-aligned rectangle in a host face's `(u, v)` frame. */
export interface HostRect {
  readonly u0: number;
  readonly u1: number;
  readonly v0: number;
  readonly v1: number;
}

type HostRuntime = Pick<ToolContext["runtime"], "projectToHost" | "resolveOnHost">;

/** One host face measured through the engine's own resolve, so world-unit sizes convert to `(u, v)` exactly as the mesher sees them. */
export interface HostFrame {
  readonly hostSurfaceKey: ConstructionSurfaceKey;
  /** World length of the face's base run. */
  readonly length: number;
  /** World height of the face at `u`. */
  heightAt(u: number): number;
  /** The smallest world height over `[u0, u1]`. */
  minHeightBetween(u0: number, u1: number): number;
  resolve(uv: readonly (readonly [number, number])[]): readonly ConstructionPosition[];
  project(points: readonly ConstructionPosition[]): readonly ConstructionHostPoint[];
}

const LENGTH_SAMPLES = 32;
const HEIGHT_SAMPLES = 6;

const distance = (a: ConstructionPosition, b: ConstructionPosition): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** `undefined` when the face is not an upright panel the engine can frame. */
export function hostFrame(runtime: HostRuntime, hostSurfaceKey: ConstructionSurfaceKey): HostFrame | undefined {
  const resolve = (uv: readonly (readonly [number, number])[]) => runtime.resolveOnHost({ hostSurfaceKey, uv });
  let base: readonly ConstructionPosition[];
  try {
    runtime.projectToHost({ hostSurfaceKey, points: [] });
    base = resolve(Array.from({ length: LENGTH_SAMPLES + 1 }, (_, index) => [index / LENGTH_SAMPLES, 0] as const));
  } catch {
    return undefined;
  }
  let length = 0;
  for (let index = 1; index < base.length; index += 1) length += distance(base[index - 1]!, base[index]!);
  if (!(length > 1e-9)) return undefined;

  const heightsAt = (us: readonly number[]): number[] => {
    const ends = resolve(us.flatMap((u) => [[u, 0] as const, [u, 1] as const]));
    return us.map((_, index) => distance(ends[2 * index]!, ends[2 * index + 1]!));
  };
  return {
    hostSurfaceKey,
    length,
    heightAt: (u) => heightsAt([u])[0]!,
    minHeightBetween: (u0, u1) =>
      Math.min(...heightsAt(Array.from({ length: HEIGHT_SAMPLES + 1 }, (_, index) => u0 + ((u1 - u0) * index) / HEIGHT_SAMPLES))),
    resolve,
    project: (points) => (points.length === 0 ? [] : runtime.projectToHost({ hostSurfaceKey, points })),
  };
}

/**
 * `rect` repositioned (never resized) to keep {@link MARGIN} of face on every
 * side -- `undefined` when it cannot fit at all. A door keeps `v0 = 0`: it
 * sits on the floor.
 */
export function clampRect(frame: HostFrame, rect: HostRect, isDoor: boolean): HostRect | undefined {
  const du = rect.u1 - rect.u0;
  const uMargin = MARGIN / frame.length;
  if (!(du > 0) || du > 1 - 2 * uMargin) return undefined;
  const u0 = Math.max(uMargin, Math.min(rect.u0, 1 - uMargin - du));
  const u1 = u0 + du;

  const height = frame.minHeightBetween(u0, u1);
  if (!(height > 0)) return undefined;
  const vMargin = MARGIN / height;
  const dv = rect.v1 - rect.v0;
  if (!(dv > 0)) return undefined;
  if (isDoor) return dv > 1 - vMargin ? undefined : { u0, u1, v0: 0, v1: dv };
  if (dv > 1 - 2 * vMargin) return undefined;
  const v0 = Math.max(vMargin, Math.min(rect.v0, 1 - vMargin - dv));
  return { u0, u1, v0, v1: v0 + dv };
}

/** Whether `rect` reads as a door: a door is the only opening standing on the floor. */
export function isDoorRect(rect: HostRect): boolean {
  return rect.v0 < 1e-6;
}

/** Every host an opening's nodes are pinned to, keyed by surface ref, with how many nodes each holds. */
export function hostsOf(opening: ConstructionRegionTopology): ReadonlyMap<string, { readonly hostSurfaceKey: ConstructionSurfaceKey; readonly nodeIds: readonly ConstructionNodeId[] }> {
  const hosts = new Map<string, { hostSurfaceKey: ConstructionSurfaceKey; nodeIds: ConstructionNodeId[] }>();
  for (const node of opening.nodes) {
    if (node.pin === undefined) continue;
    const ref = surfaceRefFromNodeSet(node.pin.hostSurfaceKey);
    const entry = hosts.get(ref) ?? { hostSurfaceKey: node.pin.hostSurfaceKey, nodeIds: [] };
    entry.nodeIds.push(node.id);
    hosts.set(ref, entry);
  }
  return hosts;
}

/** The host holding most of an opening's pinned nodes -- the one its `(u, v)` edits are read in. */
export function primaryHostOf(opening: ConstructionRegionTopology): ConstructionSurfaceKey | undefined {
  let best: { readonly key: ConstructionSurfaceKey; readonly count: number } | undefined;
  for (const { hostSurfaceKey, nodeIds } of hostsOf(opening).values()) {
    if (best === undefined || nodeIds.length > best.count) best = { key: hostSurfaceKey, count: nodeIds.length };
  }
  return best?.key;
}

/** The `(u, v)` bounding box `region` occupies on `frame`'s host: its own pins where they are on this host, a projection otherwise. */
export function spanOn(frame: HostFrame, region: ConstructionRegionTopology): HostRect | undefined {
  const hostRef = surfaceRefFromNodeSet(frame.hostSurfaceKey);
  const uvs: { u: number; v: number }[] = [];
  const foreign: ConstructionPosition[] = [];
  for (const node of region.nodes) {
    if (node.pin !== undefined && surfaceRefFromNodeSet(node.pin.hostSurfaceKey) === hostRef) uvs.push(node.pin);
    else foreign.push(node.position);
  }
  if (foreign.length > 0) {
    try {
      uvs.push(...frame.project(foreign));
    } catch {
      return undefined;
    }
  }
  if (uvs.length === 0) return undefined;
  const us = uvs.map((uv) => uv.u);
  const vs = uvs.map((uv) => uv.v);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/**
 * Whether `rect` would overlap any other region already pinned to `frame`'s
 * host -- touching is fine, sharing area is refused (never merged).
 */
export function overlapsSibling(ctx: ToolContext, frame: HostFrame, rect: HostRect, excludeSurfaceKey?: ConstructionSurfaceKey): boolean {
  const hostRef = surfaceRefFromNodeSet(frame.hostSurfaceKey);
  const excluded = excludeSurfaceKey === undefined ? undefined : surfaceRefFromNodeSet(excludeSurfaceKey);
  const EPS = 1e-9;
  return ctx.runtime.getAllRegionTopologies().some((region) => {
    if (excluded !== undefined && surfaceRefFromNodeSet(region.surfaceKey) === excluded) return false;
    if (!hostsOf(region).has(hostRef)) return false;
    const other = spanOn(frame, region);
    if (other === undefined) return false;
    return rect.u0 < other.u1 - EPS && rect.u1 > other.u0 + EPS && rect.v0 < other.v1 - EPS && rect.v1 > other.v0 + EPS;
  });
}

const CURVE_TOLERANCE = 1e-3;
const CURVE_STEP = 0.25;
const MAX_CURVE_SEGMENTS = 32;

/** How many straight pieces each horizontal side needs to follow the face: one on a flat face, more where the face bends. */
function horizontalSegments(frame: HostFrame, rect: HostRect): number {
  const uMid = (rect.u0 + rect.u1) / 2;
  const [a, b, mid] = frame.resolve([[rect.u0, rect.v0], [rect.u1, rect.v0], [uMid, rect.v0]]);
  const chordMid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2, z: (a!.z + b!.z) / 2 };
  if (distance(chordMid, mid!) <= CURVE_TOLERANCE) return 1;
  return Math.min(MAX_CURVE_SEGMENTS, Math.max(2, Math.ceil(((rect.u1 - rect.u0) * frame.length) / CURVE_STEP)));
}

/** `rect`'s boundary as `(u, v)` pairs in walking order: bottom left to right, then top right to left. */
export function rectLoop(frame: HostFrame, rect: HostRect, segments = horizontalSegments(frame, rect)): readonly (readonly [number, number])[] {
  const du = (rect.u1 - rect.u0) / segments;
  const bottom = Array.from({ length: segments + 1 }, (_, index) => [index === segments ? rect.u1 : rect.u0 + du * index, rect.v0] as const);
  const top = Array.from({ length: segments + 1 }, (_, index) => [index === segments ? rect.u0 : rect.u1 - du * index, rect.v1] as const);
  return [...bottom, ...top];
}

export interface OpeningPlacement {
  readonly frame: HostFrame;
  readonly rect: HostRect;
}

function buildOpeningPatch(ctx: ToolContext, idPrefix: string, place: OpeningPlacement) {
  const loop = rectLoop(place.frame, place.rect);
  const positions = place.frame.resolve(loop);
  const nodes = positions.map((position, index) => ({ id: `${idPrefix}:c${index}` as ConstructionNodeId, position }));
  const edges = createBoundaryEdges(ctx.tableId, {
    kind: "private-when-full",
    runPrefix: idPrefix,
    existingUses: boundaryUsage(ctx),
  });
  const boundary: ConstructionOrientedEdgeUse[] = nodes.map((node, index) => edges.use(node.id, nodes[(index + 1) % nodes.length]!.id));
  const pins = nodes.map((node, index) => ({ nodeId: node.id, hostSurfaceKey: place.frame.hostSurfaceKey, u: loop[index]![0], v: loop[index]![1] }));
  return {
    pins,
    patch: {
      nodes,
      edges: edges.all(),
      regions: [
        {
          regionId: nodes.map((node) => node.id).join("|"),
          boundary,
          surfaceType: openingStructureType.surfaceType,
          physical: false,
        },
      ],
    },
  };
}

/**
 * One transaction: optionally delete an existing opening region, then
 * optionally add a new one with its own nodes, every node pinned to the
 * host. Both is a move or resize; only `removal` a delete; only `place` a
 * creation.
 */
export function commitOpeningReplacement(
  ctx: ToolContext,
  causeId: string,
  removal: ConstructionSurfaceKey | undefined,
  place: OpeningPlacement | undefined,
): { readonly recorded: boolean; readonly error?: string } {
  let recorded = false;
  try {
    ({ recorded } = commitChange(ctx.runtime, { transactionId: causeId }, () => {
      if (removal !== undefined) ctx.runtime.applyRegionEdit([{ kind: "delete-region", surfaceKey: removal }], "local", causeId);
      if (place === undefined) return { value: undefined };

      const idPrefix = scopedToolId(ctx, `opening-${ctx.nextSequence()}`);
      const { pins, patch } = buildOpeningPatch(ctx, idPrefix, place);
      const outcome = ctx.runtime.addPatch(patch, "local", causeId);
      if (outcome.skippedRegionIds.length > 0) throw new Error("a face nao coube sobre o que ja existe ali.");
      ctx.runtime.pinNodes(pins, "local", causeId);
      return { value: outcome, change: shapeChangeOfAddition(ctx.runtime, patch, outcome) };
    }));
  } catch (error) {
    return { recorded: false, error: error instanceof Error ? error.message : String(error) };
  }
  return { recorded };
}
