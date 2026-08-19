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
export { createMoveNodeHistoryStack } from "./move-node-history.ts";
export type { ConstructionHistoryEntry, MoveNodeHistoryEntry, MoveNodeHistoryStack, MoveNodeHistoryState, PathBrushHistoryEntry } from "./move-node-history.ts";
export { DEFAULT_TOOL_PARAMS, TOWER_RADIUS_PRESETS } from "./tool-types.ts";
export type {
  BrushShapeKind,
  BrushShapeParams,
  ConstructionToolId,
  InteriorGenerateParams,
  IrregularTerrainParams,
  PathBrushParams,
  NoToolParams,
  PreviewDescriptor,
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

export { resolveBrushShape } from "./brush-shape-params.ts";
export {
  PATH_BRUSH_SOURCE_SURFACE_TYPES,
  SURFACE_EDIT_MODE_DEFINITIONS,
  surfaceEditModeFor,
} from "./surface-edit-mode-registry.ts";
