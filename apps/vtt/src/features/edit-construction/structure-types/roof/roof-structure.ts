import { ALL_AXES } from "../../orchestration/atomic-edit.ts";
import { IGNORE } from "../creation-interaction.ts";
import { allowed, denied, type StructureTypeDefinition } from "../structure-type.ts";

/** Roof profiles move as a connected cloud; this delivery adds no shape handles. */
export const roofStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: "roof", label: "Telhado", creation: "analytic sheets with one horizontal base and maximum height",
  roleFor: (_topology, target) => `roof-${target.kind}`,
  policyFor: (role) => role === "roof-region"
    ? { ...allowed(role, ALL_AXES, "cloud"), transport: true }
    : denied(role, "Mova o telhado pela face."),
  interactionOver: () => IGNORE,
  repairAfterCut: { kind: "preserve", reason: "Roof section changes require whole-cover regeneration." },
  motionInfluences: (topology) => {
    const anchor = topology.nodes[0];
    return anchor ? topology.nodes.slice(1).flatMap((node) => [
      { from: anchor.id, to: node.id, axes: [true, true, true] as const },
      { from: node.id, to: anchor.id, axes: [true, true, true] as const },
    ]) : [];
  },
});
