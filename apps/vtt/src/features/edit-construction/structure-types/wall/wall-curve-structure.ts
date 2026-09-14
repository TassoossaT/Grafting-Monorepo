import { panelMotionInfluences, panelRoleFor, validatePanelMotion } from "../panel/panel-structure.ts";
import { denied, type StructureTypeDefinition } from "../structure-type.ts";
import { IGNORE } from "../creation-interaction.ts";
import { regenerateWallCurveSpine } from "./wall-curve-spine.ts";

/**
 * A wall built along a spine instead of a drawn contour: same upright-panel
 * shape a brush or a line wall makes (`panel-structure.ts`), curved by the
 * shared bezier spine instead. A sibling of the plain wall types rather than
 * a mode on them, for the same reason a sloped platform is a sibling of a
 * flat one (`platform-structure.ts`): its faces are never grabbed directly,
 * the spine is what is edited.
 */
export function wallCurveStructureType(surfaceType: string, label: string): StructureTypeDefinition {
  return Object.freeze<StructureTypeDefinition>({
    surfaceType,
    label,
    creation: "one upright panel per spine station, sampled along its bezier curve",
    roleFor: panelRoleFor,
    motionInfluences: panelMotionInfluences,
    validateMotion: validatePanelMotion,
    policyFor: (role) => denied(role, "Edite a parede pelos nos e alcas do eixo."),
    interactionOver: () => IGNORE,
    repairAfterCut: { kind: "preserve", reason: "Uma parede sobre eixo ainda nao participa de recortes." },
    spine: Object.freeze({ defaultOffsets: [3], regenerate: regenerateWallCurveSpine(surfaceType) }),
  });
}
