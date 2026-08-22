export {
  applyMapProjectionDelta,
  createMapProjection,
  createSurfaceProjection,
  surfaceRefFromNodeSet,
} from "./map-projection.ts";
export type {
  MapId,
  MapProjection,
  MapProjectionDelta,
  NodePosition,
  NodePositionEntry,
  NodeRef,
  SurfaceProjection,
  SurfaceRef,
} from "./map-projection.ts";
export {
  NONE_COVERING,
  NONE_COVERING_KIND,
  PAINTED_COVERING_KIND,
  colorForSurfaceType,
  paintedCovering,
  resolveSurfaceCovering,
} from "./surface-covering.ts";
export type { CoveringKind, SurfaceCovering, SurfaceFill } from "./surface-covering.ts";
