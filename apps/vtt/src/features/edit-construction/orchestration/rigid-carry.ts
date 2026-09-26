import type { ConstructionPosition, ConstructionRegionTopology } from "@/ports";

import { structureTypeFor } from "../structure-types/index.ts";
import { keepsOutline } from "../topology/contour-offset.ts";

/**
 * Rigid structures (`StructureTypeDefinition.rigid`) change shape only
 * through their own controls. When anything else moves some of their nodes
 * -- a ramp welded into a platform moved, a wall's foot dragged -- the
 * whole structure is carried along as one piece: translated, turned, raised,
 * by the transform that best matches how those nodes moved. A node only
 * sliding along its own side, keeping the outline, carries nothing.
 */

type Place = (p: ConstructionPosition) => ConstructionPosition;

/** The rigid motion -- a turn in plan, a shift, a rise -- that best takes every `from` to its `to`. */
export function fitRigidMotion(pairs: readonly { readonly from: ConstructionPosition; readonly to: ConstructionPosition }[]): Place {
  const n = pairs.length;
  const mean = (pick: (pair: (typeof pairs)[number]) => number) => pairs.reduce((sum, pair) => sum + pick(pair), 0) / n;
  const cf = { x: mean((p) => p.from.x), z: mean((p) => p.from.z) };
  const ct = { x: mean((p) => p.to.x), z: mean((p) => p.to.z) };
  const dy = mean((p) => p.to.y - p.from.y);
  let cross = 0, dot = 0;
  for (const { from, to } of pairs) {
    const a = { x: from.x - cf.x, z: from.z - cf.z }, b = { x: to.x - ct.x, z: to.z - ct.z };
    cross += a.x * b.z - a.z * b.x;
    dot += a.x * b.x + a.z * b.z;
  }
  // One node, or nodes all moved alike, say nothing about turning.
  const angle = n < 2 || (Math.abs(cross) < 1e-12 && dot >= 0) ? 0 : Math.atan2(cross, dot);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return (p) => {
    const x = p.x - cf.x, z = p.z - cf.z;
    return { x: ct.x + x * cos - z * sin, y: p.y + dy, z: ct.z + x * sin + z * cos };
  };
}

const keyOf = (topology: ConstructionRegionTopology) => topology.surfaceKey.join("\u0000");
const same = (a: ConstructionPosition, b: ConstructionPosition) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;

/**
 * Where every node of each rigid structure among `topologies` must go so
 * that `moved` carries it whole -- empty when none is bent. Structures in
 * `direct` are the ones the gesture itself edits: their own controls shape
 * them.
 */
export function rigidCarries(
  topologies: readonly ConstructionRegionTopology[],
  moved: ReadonlyMap<string, ConstructionPosition>,
  direct: ReadonlySet<string>,
): ReadonlyMap<string, ConstructionPosition> {
  const carried = new Map<string, ConstructionPosition>();
  for (const topology of topologies) {
    if (structureTypeFor(topology.surfaceType)?.rigid !== true || direct.has(keyOf(topology))) continue;
    const pairs = topology.nodes.flatMap((node) => {
      const to = moved.get(node.id);
      return to && !same(to, node.position) ? [{ from: node.position, to }] : [];
    });
    if (pairs.length === 0 || keepsOutline(topology, moved)) continue;
    const place = fitRigidMotion(pairs);
    const whole = topology.nodes.map((node) => [node.id, place(node.position)] as const);
    // Already carried whole -- a translation that reached every node.
    if (whole.every(([id, position]) => moved.has(id) && same(moved.get(id)!, position))) continue;
    for (const [id, position] of whole) carried.set(id, position);
  }
  return carried;
}

/**
 * Every structure joined to `seeds` through shared nodes, `seeds` included --
 * what turns or moves as one when a whole-structure handle acts on one of
 * them. Ground is never part of it: it is re-cut around what lands, not
 * carried.
 */
export function joinedStructures(
  topologies: readonly ConstructionRegionTopology[],
  seeds: readonly ConstructionRegionTopology[],
  isGround: (surfaceType: string) => boolean,
): readonly ConstructionRegionTopology[] {
  const members = new Map(seeds.map((topology) => [keyOf(topology), topology]));
  const nodes = new Set(seeds.flatMap((topology) => topology.nodes.map((node) => node.id)));
  for (let grew = true; grew;) {
    grew = false;
    for (const topology of topologies) {
      if (members.has(keyOf(topology)) || isGround(topology.surfaceType) || !topology.nodes.some((node) => nodes.has(node.id))) continue;
      members.set(keyOf(topology), topology);
      for (const node of topology.nodes) nodes.add(node.id);
      grew = true;
    }
  }
  return [...members.values()];
}
