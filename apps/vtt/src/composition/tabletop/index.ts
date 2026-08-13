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
  FloorSlicer,
  IconCutaway,
  IconMoveNode,
  IconNavigate,
  IconRedo,
  IconSparkles,
  IconTerrain,
  IconUndo,
  IconWall,
  MaterialPalette,
  RadialMenu,
} from "../../features/ui/index.ts";
export type {
  FloorSlicerProps,
  MaterialOption,
  MaterialPaletteProps,
  RadialMenuItem,
  RadialMenuProps,
} from "../../features/ui/index.ts";

