// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { GridLayout } from "@grafting/ui";

const meta: Meta<typeof GridLayout> = {
  title: "Atoms/GridLayout",
  component: GridLayout,
  argTypes: {
    panels: { control: "object" },
    ariaLabel: { control: "text" },
    columns: { control: "number" },
    rowHeight: { control: "number" },
    gap: { control: "number" },
    draggable: { control: "boolean" },
    resizable: { control: "boolean" },
    className: { control: "text" },
  },
};
export default meta;

type Story = StoryObj<typeof GridLayout>;

export const Default: Story = {
  args: {
    panels: [{ placement: { id: "p1", x: 0, y: 0, width: 12, height: 4 }, content: <div>Panel</div> }],
    ariaLabel: "Studio dashboard",
    onPlacementsChange: fn(),
  },
};
