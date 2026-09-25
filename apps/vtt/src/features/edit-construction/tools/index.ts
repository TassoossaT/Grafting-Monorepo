export { resolveBrushShape } from "./brush-shape-params.ts";
export { OPENING_SHAPE_PROP, isRectangleShape, sameShape, shapeFromProps, shapeProps } from "./opening-shape.ts";
export {
  clipPathToStrip,
  mapPath,
  openingPath,
  pointAt,
  reversePath,
  segmentExtremes,
  sideArc,
  splitSegment,
  startAtLowest,
  type OutlineSegment,
} from "./opening-path.ts";
export { DEFAULT_STRUCTURE_EDIT_PARAMS, DEFAULT_TOOL_PARAMS, OPENING_KIND_COLOR, RECTANGLE_OPENING_SHAPE, TOWER_RADIUS_PRESETS, deriveFaceSize, withOpeningKind } from "./tool-types.ts";
export type {
  BrushShapeKind,
  BrushShapeParams,
  ConstructionToolId,
  NoToolParams,
  OpeningParams,
  OpeningShape,
  OpeningSide,
  PathBrushParams,
  PathKind,
  PreviewDescriptor,
  StructureEditParams,
  TerrainSculptMode,
  TerrainSculptParams,
  ToolParamsByTool,
  ToolParamsFor,
  TowerStampParams,
  WallBrushParams,
  WallParams,
} from "./tool-types.ts";
