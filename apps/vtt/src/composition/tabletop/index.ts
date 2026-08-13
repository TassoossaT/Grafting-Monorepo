export { createTabletopRuntime } from "./create-tabletop-runtime.ts";
export type { CreateTabletopRuntimeInput } from "./create-tabletop-runtime.ts";
export type {
  ConfirmedTokenDeltaEnvelope,
  TabletopRuntime,
  TabletopRuntimeListener,
  TabletopRuntimeStatus,
  TabletopSnapshot,
} from "./tabletop-runtime.ts";
export { buildGenerateTerrainCellOperation, buildGenerateWallOperation } from "./default-map-seed.ts";

// Re-exported (not imported directly by `app/`, per this layer's own
// boundary rule -- see `test/architecture-boundaries.test.mjs`) so
// `TabletopEntry` can build edit-mode history/operations without reaching
// past `composition` into `features`/`ports` itself.
export { createMoveNodeHistoryStack } from "../../features/edit-construction/index.ts";
export type {
  MoveNodeHistoryEntry,
  MoveNodeHistoryStack,
  MoveNodeHistoryState,
} from "../../features/edit-construction/index.ts";
export type { ConstructionPosition, RenderViewId } from "@/ports";

export {
  CategoryDock,
  FloorLevelSlicer,
  MaterialSwatchGrid,
  RadialContextMenu,
  StudioPropertyInspector,
  type RadialMenuItem,
} from "../../ui/index.ts";
