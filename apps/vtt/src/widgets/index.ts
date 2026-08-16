export { ToolRail, type EditTool, type ToolRailProps } from "./tool-rail.tsx";
export { ConstructionHotbar, type ConstructionHotbarProps } from "./construction-hotbar.tsx";
export { ConstructionDock, type ConstructionDockProps } from "./construction-dock.tsx";
export { SettingsDrawer, type SelectedNodeInfo, type SettingsDrawerProps } from "./settings-drawer.tsx";
export { ConstructionToolParamsPanel, type ConstructionToolParamsPanelProps } from "./construction-tool-params-panel.tsx";
export { useKeyboardShortcuts, type KeyboardShortcutsOptions } from "./use-keyboard-shortcuts.ts";

// Re-exported (widgets/ may import features/ directly, see
// `test/architecture-boundaries.test.mjs`) so `tool-rail.tsx`/
// `construction-hotbar.tsx`/`construction-tool-params-panel.tsx` and
// `TabletopEntry` (via this barrel) share one tool vocabulary.
export { DEFAULT_TOOL_PARAMS } from "@/features/edit-construction";
export type { ConstructionToolId, ToolParamsByTool, ToolParamsFor } from "@/features/edit-construction";
