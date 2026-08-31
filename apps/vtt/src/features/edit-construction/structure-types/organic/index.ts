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
  densifyPaintedEdges,
  planOrganicCutRepair,
  repairOrganicCut,
} from "./organic-cut-repair.ts";
export type {
  CutRepairKnownEdge,
  CutRepairPaintedEdge,
  CutRepairWeldCandidate,
  DensifiedPaintedEdges,
  OrganicCutRepairLattice,
  OrganicCutRepairPlanInput,
  OrganicCutRepairRuntime,
} from "./organic-cut-repair.ts";
