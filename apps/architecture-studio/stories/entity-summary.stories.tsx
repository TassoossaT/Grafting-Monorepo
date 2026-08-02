// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { EntitySummary } from "@grafting/ui";

const meta: Meta<typeof EntitySummary> = {
  title: "Molecules/EntitySummary",
  component: EntitySummary,
  argTypes: {
    title: { control: "text" },
    description: { control: "text" },
    status: { control: "select", options: ["neutral","info","success","warning","error"] },
    statusLabel: { control: "text" },
    leading: { control: false },
    actions: { control: false },
    ariaLabel: { control: "text" },
    className: { control: "text" },
    accentColor: { control: "text" },
    backgroundColor: { control: "text" },
    fillContainer: { control: "boolean" },
    interactive: { control: "boolean" },
    selected: { control: "boolean" },
    selectedColor: { control: "text" },
    borderWidth: { control: "number" },
    borderRadius: { control: "number" },
    bodyPadding: { control: "number" },
    contentGap: { control: "number" },
    tags: { control: false },
    glowColor: { control: "text" },
    shape: { control: "select", options: ["rectangle","pill","circle","hexagon"] },
    actionLabel: { control: "text" },
  },
};
export default meta;

type Story = StoryObj<typeof EntitySummary>;

export const Default: Story = {
  args: {
    title: "architecture-studio",
    description: "project",
    onAction: fn(),
  },
};
