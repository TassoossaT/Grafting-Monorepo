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
  PAINTED_COVERING_KIND,
  colorForSurfaceType,
  resolveSurfaceCovering,
} from "./surface-covering.ts";
export type { CoveringKind, SurfaceCovering } from "./surface-covering.ts";
