// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@grafting/ui";

const meta: Meta<typeof Text> = {
  title: "Atoms/Text",
  component: Text,
  argTypes: {
    content: { control: "text" },
    tone: { control: "select", options: ["default","muted","accent","danger"] },
    strong: { control: "boolean" },
    truncate: { control: "boolean" },
    tooltip: { control: "text" },
    maxWidth: { control: "number" },
    className: { control: "text" },
  },
};
export default meta;

type Story = StoryObj<typeof Text>;

export const Default: Story = {
  args: {
    content: "Example label",
  },
};
