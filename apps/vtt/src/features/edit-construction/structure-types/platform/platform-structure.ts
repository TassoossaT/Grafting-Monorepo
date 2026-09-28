import type { ConstructionMotionInfluence, ConstructionPosition, ConstructionRegionTopology } from "@/ports";
import { ALL_AXES, HORIZONTAL_AXES } from "../../orchestration/atomic-edit.ts";
import { acrossContourSide, pushContourCorner, pushContourSide } from "../../topology/contour-offset.ts";
import { CUT, IGNORE } from "../creation-interaction.ts";
import {
  controlRungId,
  controlSectionId,
  deriveSlopeMotion,
  regenerateSlopeSpine,
  SLOPE_DEFAULT_OFFSETS,
  SLOPE_SURFACE_TYPE,
  slopeMotionInfluences,
  validateSlopeMotion,
} from "./platform-slope-spine.ts";
import { allowed, denied, type EditRole, type RolePolicy, type StructureTypeDefinition, type StructureView } from "../structure-type.ts";

/**
 * What grabbing a platform does: the body moves the whole cloud, anywhere;
 * a side or a corner only resizes it -- the side, or both sides at the
 * corner, pushed out or in square to themselves, their neighbours sliding
 * to follow (`topology/contour-offset.ts`). Heights are the whole
 * platform's, changed by its height handle, never by a side or a corner.
 */
function platformPolicy(role: EditRole): RolePolicy {
  switch (role) {
    case "platform-region": return { ...allowed(role, ALL_AXES, "cloud"), transport: true };
    case "platform-edge": return {
      ...allowed(role, HORIZONTAL_AXES, "surface"),
      constrain: ({ topology, target, delta }) => (target.kind === "edge" ? acrossContourSide(topology, target.edgeId, delta) : delta),
      place: ({ topology, target, delta }) => (target.kind === "edge" ? pushContourSide(topology, target.edgeId, delta) : undefined),
    };
    case "platform-vertex": return {
      ...allowed(role, HORIZONTAL_AXES, "surface"),
      place: ({ topology, target, delta }) => (target.kind === "vertex" ? pushContourCorner(topology, target.nodeId, delta) : undefined),
    };
    default: return denied(role, "Vertice fora da plataforma.");
  }
}

/**
 * Ground under a platform may be cut, and the ground's own repair regenerates
 * around it -- only where the platform touches it (`topology/ground-contact.ts`):
 * one high over the terrain leaves it whole, one on a hillside cuts only the
 * hill it runs into.
 */
export const cutsGround = (covered: StructureView) => covered.traits.has("ground") ? CUT : IGNORE;

/** How far apart two heights may be and still be one elevation. */
const LEVEL = 1e-4;

/**
 * A flat structure's law: every node at one elevation -- the one the nodes the
 * change placed agree on; with none placed, or placed at different heights,
 * nothing is settled and the type's validation judges it.
 */
function settleLevel(topology: ConstructionRegionTopology, positions: ReadonlyMap<string, ConstructionPosition>, placed: ReadonlySet<string>): ReadonlyMap<string, ConstructionPosition> {
  const heights = topology.nodes.filter((node) => placed.has(node.id)).map((node) => (positions.get(node.id) ?? node.position).y);
  if (heights.length === 0 || heights.some((y) => Math.abs(y - heights[0]!) > LEVEL)) return new Map();
  const y = heights[0]!;
  const settled = new Map<string, ConstructionPosition>();
  for (const node of topology.nodes) {
    const at = positions.get(node.id) ?? node.position;
    if (!placed.has(node.id) && Math.abs(at.y - y) > 1e-9) settled.set(node.id, { ...at, y });
  }
  return settled;
}

/**
 * A horizontal structural marker, independently usable as floor or ceiling,
 * drawn as a flat closed contour at one elevation. Whether it rests on the
 * ground or stands over it is not declared: it is where it is, and the
 * ground is cut only where it touches it.
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
    // A floor is solid: only its own sides, corners and handles reshape it.
    rigid: true,
    roleFor: (topology, target) => target.kind === "vertex" && !topology.nodes.some((node) => node.id === target.nodeId) ? "platform-unknown" : `platform-${target.kind}`,
    policyFor: platformPolicy,
    interactionOver,
    globalHandles: Object.freeze(["pivot", "rotate", "height", "side", "corner"] as const),
    partHandle: (role) => role === "platform-edge" || role === "platform-vertex",
    motionInfluences: (topology, transport): readonly ConstructionMotionInfluence[] => {
      const anchor = topology.nodes[0];
      if (!anchor) return [];
      // A star per face is linear; shared nodes connect faces in the Rust solver.
      const axes = [transport, true, transport] as const;
      return topology.nodes.slice(1).flatMap((node) => [
        { from: anchor.id, to: node.id, axes }, { from: node.id, to: anchor.id, axes },
      ]);
    },
    // Its law: one elevation. What the change placed sets it; the rest of the face follows.
    settle: settleLevel,
    validateMotion: (topology, positions) => {
      const elevations = topology.nodes.map((node) => (positions.get(node.id) ?? node.position).y);
      return elevations.some((y) => Math.abs(y - elevations[0]!) > 1e-4)
        ? "Todos os vertices da plataforma devem permanecer na mesma elevacao." : undefined;
    },
  });
}

/** A floor: on the ground it takes the ground under it, which regenerates around it; over it, the ground is left as it is. */
export const platformStructureType = contourPlatformStructureType("platform", "Plataforma", cutsGround);

/**
 * The platform built along a spine instead of a contour: a surface whose
 * height varies along its curve and never across it -- a ramp, a sloped
 * walkway, a spiral climb. What dresses it -- steps, treads, rails -- is the
 * assets' business; the structure only declares where they go.
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
  // Where it runs into the ground -- a flight dug into a slope -- it cuts it; over it, it leaves it.
  interactionOver: cutsGround,
  // Rebuilt from its spine and welded by its ends: ground cut round it meets it without sharing its nodes.
  sealedOutline: true,
  motionInfluences: slopeMotionInfluences,
  deriveMotion: deriveSlopeMotion,
  validateMotion: validateSlopeMotion,
  spine: Object.freeze({
    defaultOffsets: SLOPE_DEFAULT_OFFSETS, regenerate: regenerateSlopeSpine, planOnly: true,
    endRung: (controlNodeId: string) => ({ edgeId: controlRungId(controlNodeId), startNodeId: controlSectionId(controlNodeId, "min"), endNodeId: controlSectionId(controlNodeId, "max") }),
  }),
  globalHandles: Object.freeze(["pivot", "rotate", "height", "turns", "radius", "originHeight", "destinationHeight"] as const),
});
