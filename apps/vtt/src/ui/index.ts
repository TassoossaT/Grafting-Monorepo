export { TerrainShapePicker } from "./terrain-shape-picker.tsx";
export type { CornerHeights, TerrainShapePickerProps } from "./terrain-shape-picker.tsx";
export { lerp, mulberry32 } from "./seeded-random.ts";

// Re-exported so `widgets/` (which, like this layer, may not import
// `@grafting/*` directly -- see `test/architecture-boundaries.test.mjs`) can
// build this app's toolbars/panels on the shared atoms instead of hand-rolled
// buttons/chips/panels.
export {
  Button,
  type ButtonProps,
  Card,
  type CardProps,
  Drawer,
  type DrawerProps,
  IconButton,
  type IconButtonProps,
  Popover,
  type PopoverProps,
  SelectableChip,
  type SelectableChipProps,
  StatusBadge,
  type StatusBadgeProps,
} from "@grafting/ui";
