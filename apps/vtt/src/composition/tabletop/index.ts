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
export { buildGenerateRoomOperations, layoutNextRoomOrigin, ROOM_DEPTH, ROOM_HEIGHT, ROOM_WIDTH } from "./room-seed.ts";
export type { RoomLayout } from "./room-seed.ts";

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
export type { CameraControlHandle, CameraControlOptions, ConstructionPosition, RenderViewId } from "@/ports";

// Re-exported for the same reason as `createMoveNodeHistoryStack` above --
// `navigate-camera` is a `features/` verb, and `TabletopEntry` must not
// reach past `composition` into `features` itself.
export { attachCameraNavigation } from "../../features/navigate-camera/index.ts";
