export {
  createGeneratePathExtrusionOperation,
  createGenerateTerrainCellOperation,
  createMoveNodeOperation,
} from "./construction-operations.ts";
export type {
  ConstructionOperation,
  ConstructionOperationContext,
  GeneratePathExtrusionOperation,
  GenerateTerrainCellOperation,
  MoveNodeOperation,
  MoveNodePayload,
  OperationId,
  ParticipantId,
  RevisionPrecondition,
} from "./construction-operations.ts";
export { createEditHistoryStack } from "./edit-history.ts";
export type { ConstructionHistoryEntry, EditHistoryStack, EditHistoryState, PathBrushHistoryEntry, RegionEditHistoryEntry } from "./edit-history.ts";
export { DEFAULT_TOOL_PARAMS, TOWER_RADIUS_PRESETS } from "./tool-types.ts";
export type {
  BrushShapeKind,
  BrushShapeParams,
  ConstructionToolId,
  InteriorGenerateParams,
  PathBrushParams,
  NoToolParams,
  PreviewDescriptor,
  TerrainSculptParams,
  ToolParamsByTool,
  ToolParamsFor,
  TowerStampParams,
  WallBrushParams,
} from "./tool-types.ts";
export { createPathBrushEffect } from "./surface-edit-contract.ts";
export type {
  BrushGestureRegion,
  BrushGestureSample,
  BrushShape,
  PathBrushEffect,
  PathFormationParameters,
  SurfaceEditModeDefinition,
  SurfaceEditTargetScope,
} from "./surface-edit-contract.ts";

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
  ORGANIC_ROLES,
  PANEL_ROLES,
  STRUCTURE_TYPE_DEFINITIONS,
  resolvePolicy,
  structureTypeFor,
} from "./structure-types/index.ts";
export type {
  CascadeContext,
  EditResolution,
  EditRole,
  RolePolicy,
  StructureTypeDefinition,
} from "./structure-types/index.ts";

export { resolveBrushShape } from "./brush-shape-params.ts";
export {
  PATH_BRUSH_SOURCE_SURFACE_TYPES,
  SURFACE_EDIT_MODE_DEFINITIONS,
  surfaceEditModeFor,
} from "./surface-edit-mode-registry.ts";
