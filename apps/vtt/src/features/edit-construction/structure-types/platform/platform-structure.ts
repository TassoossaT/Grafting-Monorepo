import type { ConstructionMotionInfluence } from "@/ports";
import { ALL_AXES } from "../../orchestration/atomic-edit.ts";
import { CUT, IGNORE } from "../creation-interaction.ts";
import {
  deriveSlopeMotion,
  regenerateSlopeSpine,
  SLOPE_DEFAULT_OFFSETS,
  SLOPE_SURFACE_TYPE,
  slopeMotionInfluences,
  validateSlopeMotion,
} from "./platform-slope-spine.ts";
import { allowed, denied, type StructureTypeDefinition, type StructureView } from "../structure-type.ts";

/** Ground under a platform is cut, and the ground's own repair regenerates around it. */
const cutsGround = (covered: StructureView) => covered.traits.has("ground") ? CUT : IGNORE;
/** A floating structure stands over the ground without touching it: the terrain below is left as it is. */
const ignoresGround = () => IGNORE;

/**
 * A horizontal structural marker, independently usable as floor or ceiling,
 * drawn as a flat closed contour at one elevation.
 *
 * Built twice, once per way of meeting the ground, rather than carrying a
 * grounded/floating flag on the face. The flag would have to be stored,
 * undone and read back wherever a cut is decided; the surface type already
 * is all three. And a cloud is one type (`construction-cloud.ts`), so a
 * floating storey welded to a grounded floor stays two clouds -- they meet,
 * but lifting one never carries the other. Which type a platform is, is
 * decided when it is drawn and never changes afterwards.
 */
function contourPlatformStructureType(
  surfaceType: string,
  label: string,
  interactionOver: StructureTypeDefinition["interactionOver"],
): StructureTypeDefinition {
  return Object.freeze<StructureTypeDefinition>({
    surfaceType, label, creation: "a flat closed contour, without thickness",
    traits: Object.freeze(["floor"] as const),
    requiresMotionSolver: true,
    roleFor: (topology, target) => target.kind === "vertex" && !topology.nodes.some((node) => node.id === target.nodeId) ? "platform-unknown" : `platform-${target.kind}`,
    policyFor: (role) => role === "platform-unknown" ? denied(role, "Vertice fora da plataforma.") : ({ ...allowed(role, ALL_AXES, role === "platform-region" ? "cloud" : "surface"), transport: role === "platform-region" }),
    interactionOver,
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
}

/** A floor resting on the ground: it takes the ground under it, which regenerates around it. */
export const platformStructureType = contourPlatformStructureType("platform", "Plataforma", cutsGround);

/** A floor standing over the ground -- a storey, a bridge deck: the terrain under it is left untouched. */
export const floatingPlatformStructureType = contourPlatformStructureType("platform-floating", "Plataforma flutuante", ignoresGround);

/**
 * The platform built along a spine instead of a contour: a surface whose
 * height varies along its curve and never across it -- a ramp, a sloped
 * walkway, a spiral climb. Stairs are this same shape with a step parameter;
 * steps are appearance, not structure.
 *
 * Generated from the shared spine exactly as a road is, so its control
 * points, handles and width are edited with the same gestures; see
 * `platform-slope-spine.ts` for what it makes of a spine.
 *
 * A sibling surface type rather than a mode read off the face, because a
 * cloud is one type: a ramp welded between two floors sharing their type
 * would join both floors and itself into one cloud, and lifting one floor
 * would carry all three.
 *
 * Its faces are never grabbed directly -- the spine is what is edited. A
 * floor that moves still carries the end welded to it: the end's control
 * node follows, and the ramp re-places itself on the moved curve.
 */
export const slopedPlatformStructureType: StructureTypeDefinition = Object.freeze<StructureTypeDefinition>({
  surfaceType: SLOPE_SURFACE_TYPE, label: "Plataforma inclinada",
  creation: "one face per spine span: the span's ribbon, sampled along its bezier curve",
  traits: Object.freeze([]),
  requiresMotionSolver: true,
  roleFor: () => "platform-slope-face",
  policyFor: (role) => denied(role, "Edite a plataforma inclinada pela espinha: pontos, alças e largura."),
  // A ramp climbs between levels above the ground; it never carves it.
  interactionOver: ignoresGround,
  motionInfluences: slopeMotionInfluences,
  deriveMotion: deriveSlopeMotion,
  validateMotion: validateSlopeMotion,
  spine: Object.freeze({ defaultOffsets: SLOPE_DEFAULT_OFFSETS, regenerate: regenerateSlopeSpine }),
});
