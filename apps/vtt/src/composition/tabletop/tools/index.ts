export { toolFor } from "./core/tool-registry.ts";
export {
  scopedToolId,
  type ConstructionTool,
  type ConstructionToolFeedback,
  type PointerSample,
  type ToolContext,
  type ToolGesture,
} from "./core/tool-context.ts";
export { brushReach, createBrushTool, type BrushRegion, type BrushToolSpec, type BrushableToolId } from "./core/brush-tool.ts";
export {
  boundaryUsage,
  createBoundaryEdges,
  reverseGeometry,
  type BoundaryEdges,
  type EdgeSharing,
} from "./core/boundary-edges.ts";
export { navigateTool } from "./core/navigate-tool.ts";
export { editRegionTool } from "./core/edit-region-tool.ts";

export { terrainSculptTool } from "./terrain/terrain-sculpt-tool.ts";
export { restackTerrain } from "./terrain/terrain-restack.ts";
export { buildIrregularQuadGrid, type QuadMesh, type Vec2 as IrregularGridVec2 } from "@/features/edit-construction";

export { wallLineTool } from "./walls/wall-line-tool.ts";
export { wallBrushTool } from "./walls/wall-brush-tool.ts";
export {
  WALL_COLOR,
  WALL_HEIGHT,
  commitWallContour,
  commitWallStroke,
  findWallSurfaceAt,
  pinnedToBaseline,
  xzDistance,
} from "./walls/wall-shared.ts";
export { wallPatch, type WallColumn, type WallContour } from "./walls/wall-patch.ts";
export { wallSpans, type WallSpan } from "./walls/wall-spans.ts";
export { fitPath, type FittedEdge } from "./core/stroke-fitting.ts";

export { interiorWallTool } from "./house/interior-wall-tool.ts";
export { houseRoomDeleteTool } from "./house/house-room-delete-tool.ts";
export { cellsInPolygon, idPrefixForRoom, isRedundantPerimeterWall, type Vec2 as HouseVec2 } from "./house/interior-partition.ts";
export { findEnclosingRoom, type DerivedRoom } from "./house/room-lookup.ts";

export { openingTool } from "./openings/opening-tool.ts";
export { panelRailOf, type PanelRail } from "./openings/panel-rail.ts";

export { towerStampTool } from "./tower/tower-stamp-tool.ts";
export { circleContour, previewOutline } from "./tower/tower-geometry.ts";

export { pathBrushTool } from "./paths/path-brush-tool.ts";

export {
  brushSweptOutlinePolygons,
  brushSweptRegionFill,
  footprintQuad,
  polylineSegmentsPreview,
  quadAround,
  segmentBetween,
  segmentsPreview,
  type BrushOutlineShape,
} from "./shapes/preview-shapes.ts";

export {
  angleFromToXZ,
  distanceToPolygonBoundaryXZ,
  distanceToSegmentXZ,
  pointInPolygonXZ,
  polygonAreaXZ,
  projectOntoLineXZ,
  xzDistanceSq,
  type PointXZ,
} from "./shapes/geometry-2d.ts";
