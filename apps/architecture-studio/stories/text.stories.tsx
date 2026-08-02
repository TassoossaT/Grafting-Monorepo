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
  parameters: {
    docs: {
      description: {
        component: "Bounded text with semantic tone and optional truncation.",
      },
    },
  },
  argTypes: {
    content: { control: "text", description: "Text content rendered by the component." },
    tone: { control: "select", options: ["default","muted","accent","danger"], description: "Optional semantic color treatment.", table: { defaultValue: { summary: "\"default\"" } } },
    strong: { control: "boolean", description: "Whether the text uses the emphasized weight.", table: { defaultValue: { summary: "false" } } },
    truncate: { control: "boolean", description: "Whether overflowing single-line content is truncated with an accessible tooltip.", table: { defaultValue: { summary: "false" } } },
    tooltip: { control: "text", description: "Optional tooltip text used when truncation is enabled." },
    maxWidth: { control: "number", description: "Optional maximum width in CSS pixels.", table: { defaultValue: { summary: "\"100%\"" } } },
    className: { control: "text", description: "Optional caller-owned class name for layout composition." },
  },
};
export default meta;

type Story = StoryObj<typeof Text>;

export const Default: Story = {
  args: {
    content: "Example label",
  },
};
