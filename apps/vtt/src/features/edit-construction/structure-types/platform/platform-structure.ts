import type { ConstructionMotionInfluence, ConstructionRegionTopology } from "@/ports";
import { ALL_AXES } from "../../orchestration/atomic-edit.ts";
import { interpolateStripMotion, parseStripRungEdgeId } from "../../topology/swept-strip.ts";
import { CUT, IGNORE } from "../creation-interaction.ts";
import { isTerrainSurface } from "../organic/index.ts";
import { allowed, denied, type StructureTypeDefinition } from "../structure-type.ts";

/** A horizontal structural marker, independently usable as floor or ceiling. */
export const platformStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: "platform", label: "Plataforma", creation: "a flat closed contour, without thickness",
  roleFor: (topology, target) => target.kind === "vertex" && !topology.nodes.some((node) => node.id === target.nodeId) ? "platform-unknown" : `platform-${target.kind}`,
  policyFor: (role) => role === "platform-unknown" ? denied(role, "Vertice fora da plataforma.") : ({ ...allowed(role, ALL_AXES, role === "platform-region" ? "cloud" : "surface"), transport: role === "platform-region" }),
  interactionOver: (coveredType: string) => isTerrainSurface(coveredType) ? CUT : IGNORE,
  repairAfterCut: { kind: "preserve", reason: "Structural contour subtraction preserves the remaining planar faces and shared identities." },
  motionInfluences: (topology, transport): readonly ConstructionMotionInfluence[] => {
    const anchor = topology.nodes[0];
    if (!anchor) return [];
    // A star per face is linear; shared nodes connect faces in the Rust solver.
    const axes = [transport, true, transport] as const;
    return topology.nodes.slice(1).flatMap((node) => [
      { from: anchor.id, to: node.id, axes }, { from: node.id, to: anchor.id, axes },
    ]);
  },
  validateMotion: (topology, positions) => {
    const elevations = topology.nodes.map((node) => (positions.get(node.id) ?? node.position).y);
    return elevations.some((y) => Math.abs(y - elevations[0]!) > 1e-4)
      ? "Todos os vertices da plataforma devem permanecer na mesma elevacao." : undefined;
  },
});

/** Each station's two nodes, as the face's rung edges declare them. */
function rungs(topology: ConstructionRegionTopology): readonly (readonly [string, string])[] {
  const seen = new Set<string>();
  return [...topology.outerLoops, ...topology.holes].flat().flatMap((use) => {
    if (seen.has(use.edgeId) || parseStripRungEdgeId(use.edgeId) === undefined) return [];
    seen.add(use.edgeId);
    return [[use.startNodeId, use.endNodeId] as const];
  });
}

/**
 * The platform built along a curve instead of a contour: a strip whose
 * height varies along its axis and never across it -- a ramp, a sloped
 * walkway, a spiral climb. Stairs are this same shape with a step parameter;
 * steps are appearance, not structure.
 *
 * A sibling surface type rather than a mode read off the face, because a
 * cloud is one type: a ramp welded between two floors sharing their type
 * would join both floors and itself into one cloud, and lifting one floor
 * would carry all three.
 *
 * It keeps the flat platform's contract otherwise -- shared vertices are the
 * connection, and a floor that moves carries the ramp end welded to it. What
 * the ramp adds is how the rest of it answers: each station stays level
 * across, and the stations between a moved end and the unmoved one spread
 * the move by arc length ({@link interpolateStripMotion}) instead of the
 * last span kinking.
 */
export const slopedPlatformStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: "platform-slope", label: "Plataforma inclinada",
  creation: "a strip swept along an automatic bezier through control points, each with its own height",
  roleFor: (topology, target) => target.kind === "vertex" && !topology.nodes.some((node) => node.id === target.nodeId) ? "platform-slope-unknown" : `platform-slope-${target.kind}`,
  policyFor: (role) => role === "platform-slope-unknown" ? denied(role, "Vertice fora da plataforma inclinada.") : ({ ...allowed(role, ALL_AXES, role === "platform-slope-region" ? "cloud" : "surface"), transport: role === "platform-slope-region" }),
  interactionOver: () => IGNORE,
  repairAfterCut: { kind: "unsupported", reason: "a cut strip needs its own station split and end capping, not designed yet" },
  motionInfluences: (topology, transport): readonly ConstructionMotionInfluence[] => {
    const axes = [transport, true, transport] as const;
    return rungs(topology).flatMap(([a, b]) => [{ from: a, to: b, axes }, { from: b, to: a, axes }]);
  },
  deriveMotion: interpolateStripMotion,
  validateMotion: (topology, positions) => {
    const heightOf = (id: string) => (positions.get(id) ?? topology.nodes.find((node) => node.id === id)?.position)?.y ?? 0;
    return rungs(topology).some(([a, b]) => Math.abs(heightOf(a) - heightOf(b)) > 1e-4)
      ? "Cada secao da plataforma inclinada deve permanecer nivelada de lado a lado." : undefined;
  },
});
