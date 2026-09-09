import type { ConstructionMotionInfluence } from "@/ports";
import { ALL_AXES } from "../../orchestration/atomic-edit.ts";
import { IGNORE } from "../creation-interaction.ts";
import { allowed, denied, type StructureTypeDefinition } from "../structure-type.ts";

/** A horizontal structural marker, independently usable as floor or ceiling. */
export const platformStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: "platform", label: "Plataforma", creation: "a flat closed contour, without thickness",
  roleFor: (topology, target) => target.kind === "vertex" && !topology.nodes.some((node) => node.id === target.nodeId) ? "platform-unknown" : `platform-${target.kind}`,
  policyFor: (role) => role === "platform-unknown" ? denied(role, "Vertice fora da plataforma.") : ({ ...allowed(role, ALL_AXES, role === "platform-region" ? "cloud" : "surface"), transport: role === "platform-region" }),
  interactionOver: () => IGNORE,
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
