export { createEditHistoryStack } from "./edit-history.ts";
export type { ConstructionHistoryEntry, EditHistoryStack, EditHistoryState, PathBrushHistoryEntry, RegionEditHistoryEntry } from "./edit-history.ts";
export { DEFAULT_TOOL_PARAMS, TOWER_RADIUS_PRESETS } from "./tool-types.ts";
export type {
  BrushShapeKind,
  BrushShapeParams,
  ConstructionToolId,
  InteriorGenerateParams,
  PathKind,
  PathBrushParams,
  NoToolParams,
  OpeningParams,
  PreviewDescriptor,
  TerrainSculptParams,
  ToolParamsByTool,
  ToolParamsFor,
  TowerStampParams,
  WallBrushParams,
  WallParams,
} from "./tool-types.ts";
export { createPathBrushEffect } from "./surface-edit-contract.ts";
export {
  PATH_SPINE_OFFSET,
  pathCarvesGround,
  pathFormationFor,
  pathHalfWidth,
  pathRidesTerrain,
  pathSpineSlot,
} from "./path-recipe.ts";
export { pathCorridorId, pathSubtypeOf } from "./path-corridor.ts";
export { pathCloudPerimeter, pathRunFor, pathRunsIn, pathRunsOf } from "./path-cloud.ts";
export { edgeUseCounts, perimeterOf } from "./surface-perimeter.ts";
export type { PerimeterLoop } from "./surface-perimeter.ts";
export type {
  PathRun,
  PathRunBand,
  PathRunChain,
  PathRunNode,
  PathRunRib,
} from "./path-cloud.ts";
export {
  followsOutward,
  isSpineNode,
  parseStationNodeId,
  stationNodeId,
} from "./station-node-id.ts";
export type { StationNodeAddress } from "./station-node-id.ts";
export type {
  BrushGestureRegion,
  ConstructionOperationContext,
  RevisionPrecondition,
  BrushGestureSample,
  BrushShape,
  PathBrushEffect,
  PathFormationParameters,
  SurfaceEditModeDefinition,
  SurfaceEditTargetScope,
} from "./surface-edit-contract.ts";
export type { PathFormationRecipe, PathProfilePoint } from "./path-recipe.ts";

export {
  ALL_AXES,
  HEIGHT_AXIS,
  HORIZONTAL_AXES,
  ZERO_DELTA,
  addPosition,
  constrainToAxes,
  scalePosition,
} from "./atomic-edit.ts";
export type { AtomicEditOp, AtomicEditOpKind, EditAxis, EditGesture, EditTarget } from "./atomic-edit.ts";
export {
  EMPTY_OUTCOME,
  applyEditOp,
  applyEditPlan,
  mergeOutcomes,
  planEdit,
} from "./edit-orchestrator.ts";
export type { EditOpSink, EditPlan } from "./edit-orchestrator.ts";
export {
  cloudNodes,
  refreshCloudTopology,
  resolveCloud,
  resolveCloudTopology,
} from "./construction-cloud.ts";
export type { CloudSource, CloudTopology, ConstructionCloud } from "./construction-cloud.ts";
export {
  CUT,
  IGNORE,
  ORGANIC_ROLES,
  PANEL_ROLES,
  RESTACK,
  STRUCTURE_TYPE_DEFINITIONS,
  firstRefusal,
  forbid,
  resolveCoverage,
  resolveCreationInteraction,
  resolvePolicy,
  structureTypeFor,
} from "./structure-types/index.ts";
export type {
  CascadeContext,
  CreationInteraction,
  CreationInteractionKind,
  EditResolution,
  EditRole,
  EditScope,
  ResolvedCoverage,
  RolePolicy,
  StructureTypeDefinition,
} from "./structure-types/index.ts";

export { resolveBrushShape } from "./brush-shape-params.ts";
export {
  SURFACE_EDIT_MODE_DEFINITIONS,
  surfaceEditModeFor,
} from "./surface-edit-mode-registry.ts";
