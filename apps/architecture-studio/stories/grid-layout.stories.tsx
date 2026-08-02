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
  parameters: {
    docs: {
      description: {
        component: "Draggable/resizable dashboard layout using Grafting-owned panel contracts.\n\nConsumers whose bundler does not already provide it must import\n`react-grid-layout/css/styles.css` once at the application level; this\npackage does not import it as a side effect (it declares `sideEffects:\nfalse`), so the choice of when and whether to load that stylesheet stays\nwith the consuming application.",
      },
    },
  },
  argTypes: {
    panels: { control: "object", description: "Immutable caller-owned panels and their current placements." },
    ariaLabel: { control: "text", description: "Accessible name for the grid region." },
    columns: { control: "number", description: "Number of columns the grid is divided into.", table: { defaultValue: { summary: "12" } } },
    rowHeight: { control: "number", description: "Height of one grid row in CSS pixels.", table: { defaultValue: { summary: "32" } } },
    gap: { control: "number", description: "Gap between panels in CSS pixels, applied both horizontally and vertically.", table: { defaultValue: { summary: "12" } } },
    draggable: { control: "boolean", description: "Whether panels can be dragged to a new position." },
    resizable: { control: "boolean", description: "Whether panels can be resized." },
    onPlacementsChange: { control: false, description: "Receives the complete next placement for every panel after a drag, resize, or compaction." },
    className: { control: "text", description: "Optional caller-owned class name for layout composition." },
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
