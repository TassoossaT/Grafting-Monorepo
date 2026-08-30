export {
  ORGANIC_ROLES,
  organicPolicyFactory,
  organicRoleFor,
  organicStructureType,
  pathInteractionOver,
  terrainInteractionOver,
} from "./organic-structure.ts";
export {
  buildCutRepairLattice,
  cutRepairQuadCentroids,
  planOrganicCutRepair,
  repairOrganicCut,
} from "./organic-cut-repair.ts";
export type {
  CutRepairWeldCandidate,
  OrganicCutRepairLattice,
  OrganicCutRepairPlanInput,
  OrganicCutRepairRuntime,
} from "./organic-cut-repair.ts";
