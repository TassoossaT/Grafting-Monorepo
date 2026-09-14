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
  roleFor: () => "platform-slope-face",
  policyFor: (role) => denied(role, "Edite a plataforma inclinada pela espinha: pontos, alças e largura."),
  interactionOver: () => IGNORE,
  repairAfterCut: { kind: "unsupported", reason: "a cut span needs its own spine split and end capping, not designed yet" },
  motionInfluences: slopeMotionInfluences,
  deriveMotion: deriveSlopeMotion,
  validateMotion: validateSlopeMotion,
  spine: Object.freeze({ defaultOffsets: SLOPE_DEFAULT_OFFSETS, regenerate: regenerateSlopeSpine }),
});
