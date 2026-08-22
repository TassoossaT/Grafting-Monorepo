export { createTabletopRuntime } from "./create-tabletop-runtime.ts";
export type { CreateTabletopRuntimeInput } from "./create-tabletop-runtime.ts";
export type {
  ConfirmedTokenDeltaEnvelope,
  TabletopRuntime,
  TabletopRuntimeListener,
  TabletopRuntimeStatus,
  TabletopSnapshot,
} from "./tabletop-runtime.ts";

// Re-exported (not imported directly by `app/`, per this layer's own
// boundary rule -- see `test/architecture-boundaries.test.mjs`) so
// `TabletopEntry` can build edit-mode history/operations without reaching
// past `composition` into `features`/`ports` itself.
export { createEditHistoryStack } from "../../features/edit-construction/index.ts";
export type {
  EditHistoryStack,
  EditHistoryState,
  RegionEditHistoryEntry,
} from "../../features/edit-construction/index.ts";
export type { CameraControlHandle, CameraControlOptions, ConstructionPosition, RenderViewId } from "@/ports";

// Re-exported for the same reason as `createEditHistoryStack` above --
// `navigate-camera` is a `features/` verb, and `TabletopEntry` must not
// reach past `composition` into `features` itself.
export { attachCameraNavigation } from "../../features/navigate-camera/index.ts";

// Same reason again: the tool vocabulary is a `features/` type, `TabletopEntry`
// reaches it only through this barrel.
export { DEFAULT_TOOL_PARAMS } from "../../features/edit-construction/index.ts";
export type { ConstructionToolId, ToolParamsByTool, ToolParamsFor } from "../../features/edit-construction/index.ts";

export { useConstructionPointer } from "./use-construction-pointer.ts";
export type { ConstructionPointerHandlers, UseConstructionPointerOptions } from "./use-construction-pointer.ts";

export type { ConstructionToolFeedback } from "./tools/index.ts";
