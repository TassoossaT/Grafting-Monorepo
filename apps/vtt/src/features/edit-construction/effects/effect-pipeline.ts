import type { ConstructionRegionTopology, ConstructionTopologyBoundsQuery } from "@/ports";

import { resolveCreationInteraction, structureTypeFor } from "../structure-types/registry.ts";
import { touchesGround } from "../topology/ground-contact.ts";
import type { Effect, EffectKind, Reaction, ReactionId, ShapeChange } from "./effect.ts";

/**
 * The one place an effect's reach is defined: given the change and a hit
 * face's type, whether that face is the effect's business at all. Whether and
 * how it answers is still its type's own declaration.
 */
const EFFECT_REACH: Readonly<Record<EffectKind, (change: ShapeChange, hitType: string) => boolean>> = Object.freeze({
  cut: (change, hitType) => resolveCreationInteraction(change.surfaceType, hitType, change.subtype).kind === "cut",
  remove: (change, hitType) => hitType === change.surfaceType,
  reshape: (change, hitType) => hitType !== change.surfaceType,
});

/** How far past the change a reaction may need to look: a lattice regenerates a ring of neighbours around it. */
const REACH_MARGIN = 4;

/** Past this many chained steps the transaction aborts. A safety net, not the mechanism that ends a chain. */
export const MAX_EFFECT_DEPTH = 8;

/** A reaction refused, so the whole transaction must be rolled back. */
export class EffectRefusedError extends Error {
  readonly reactionId: ReactionId;
  readonly effectKind: EffectKind;
  readonly reason: string;

  constructor(reactionId: ReactionId, effectKind: EffectKind, reason: string) {
    super(reason);
    this.name = "EffectRefusedError";
    this.reactionId = reactionId;
    this.effectKind = effectKind;
    this.reason = reason;
  }
}

/** A chain kept emitting past {@link MAX_EFFECT_DEPTH}. */
export class EffectChainTooDeepError extends Error {
  readonly depth: number;

  constructor(depth: number, limit: number = MAX_EFFECT_DEPTH) {
    super(`effect chain exceeded ${limit} steps`);
    this.name = "EffectChainTooDeepError";
    this.depth = depth;
  }
}

/** What the pipeline reads: faces near an extent, from the live state inside the transaction. */
export interface EffectSource {
  regionsNear(bounds: ConstructionTopologyBoundsQuery): readonly ConstructionRegionTopology[];
}

/** One reaction that ran, in the order it ran. */
export interface ReactionRecord {
  readonly reactionId: ReactionId;
  readonly effectKind: EffectKind;
  readonly depth: number;
  readonly hitCount: number;
}

/** The XZ extent a change touches, widened by {@link REACH_MARGIN}. */
export function changeBounds(change: ShapeChange): ConstructionTopologyBoundsQuery | undefined {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  const include = (x: number, z: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  };
  for (const topology of [...change.before, ...change.after]) {
    for (const node of topology.nodes) include(node.position.x, node.position.z);
  }
  for (const [x, z] of change.footprintOutline ?? []) include(x, z);
  for (const position of change.declaredPositions) include(position.x, position.z);
  if (minX > maxX) return undefined;
  return { minX: minX - REACH_MARGIN, minZ: minZ - REACH_MARGIN, maxX: maxX + REACH_MARGIN, maxZ: maxZ + REACH_MARGIN };
}

/** Which reaction a type declares for an effect kind. */
export type DeclaredReaction = (surfaceType: string, kind: EffectKind) => ReactionId | undefined;

const REGISTERED_REACTION: DeclaredReaction = (surfaceType, kind) => structureTypeFor(surfaceType)?.reactions?.[kind];

/** Hit faces grouped by the reaction their type declares for `effect`, in a stable order. */
function reactionGroups(effect: Effect, regions: readonly ConstructionRegionTopology[], declared: DeclaredReaction): readonly [ReactionId, ConstructionRegionTopology[]][] {
  const groups = new Map<ReactionId, ConstructionRegionTopology[]>();
  const reach = EFFECT_REACH[effect.kind];
  for (const region of regions) {
    const reactionId = declared(region.surfaceType, effect.kind);
    if (reactionId === undefined || reactionId === effect.emittedBy) continue;
    if (!reach(effect.change, region.surfaceType)) continue;
    const group = groups.get(reactionId);
    if (group === undefined) groups.set(reactionId, [region]);
    else group.push(region);
  }
  // A cut reaches only what the changed structure touches -- now, or before it changed -- never what it stands high over.
  if (effect.kind === "cut") for (const [reactionId, hits] of groups) if (!touchesGround(effect.change, hits)) groups.delete(reactionId);
  const byKey = (topology: ConstructionRegionTopology) => topology.surfaceKey.join("\u0000");
  return [...groups]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([reactionId, hits]) => [reactionId, hits.sort((left, right) => (byKey(left) < byKey(right) ? -1 : 1))]);
}

/**
 * Dispatches `initial` and everything the reactions emit, breadth first.
 *
 * - A reaction answers each effect kind at most once per run; a later effect
 *   of the same kind reaching the same reaction is skipped. That, and a
 *   reaction never receiving its own emissions, is what ends a chain.
 * - A refusal anywhere throws {@link EffectRefusedError}. The caller runs
 *   this inside a transaction, so throwing is what rolls every step back.
 *
 * Pure orchestration: it holds no state between runs and mutates nothing
 * itself -- reactions mutate through `context`.
 */
export function runEffects<Context>(
  context: Context,
  source: EffectSource,
  initial: readonly Effect[],
  reactions: Readonly<Record<ReactionId, Reaction<Context>>>,
  declared: DeclaredReaction = REGISTERED_REACTION,
  maxDepth: number = MAX_EFFECT_DEPTH,
): readonly ReactionRecord[] {
  const queue = initial.map((effect) => ({ effect, depth: 0 }));
  const answered = new Set<string>();
  const records: ReactionRecord[] = [];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { effect, depth } = next;
    const bounds = changeBounds(effect.change);
    if (bounds === undefined) continue;
    for (const [reactionId, hits] of reactionGroups(effect, source.regionsNear(bounds), declared)) {
      const key = `${effect.kind}:${reactionId}`;
      if (answered.has(key)) continue;
      answered.add(key);
      const outcome = reactions[reactionId](context, effect, hits);
      records.push({ reactionId, effectKind: effect.kind, depth, hitCount: hits.length });
      if (outcome.kind === "refuse") throw new EffectRefusedError(reactionId, effect.kind, outcome.reason);
      for (const emitted of outcome.emitted ?? []) {
        if (depth + 1 > maxDepth) throw new EffectChainTooDeepError(depth + 1, maxDepth);
        queue.push({ effect: { ...emitted, emittedBy: reactionId }, depth: depth + 1 });
      }
    }
  }
  return records;
}
