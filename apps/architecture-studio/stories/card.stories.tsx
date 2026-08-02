// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "@grafting/ui";

const meta: Meta<typeof Card> = {
  title: "Atoms/Card",
  component: Card,
  argTypes: {
    shape: { control: "select", options: ["rectangle","pill","circle","hexagon"] },
    children: { control: false },
    ariaLabel: { control: "text" },
    accentColor: { control: "text" },
    backgroundColor: { control: "text" },
    fillContainer: { control: "boolean" },
    interactive: { control: "boolean" },
    selected: { control: "boolean" },
    selectedColor: { control: "text" },
    borderWidth: { control: "number" },
    borderRadius: { control: "number" },
    padding: { control: "number" },
    glowColor: { control: "text" },
    className: { control: "text" },
  },
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: "Body",
    ariaLabel: "Task status",
  },
};
