// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { Button } from "@grafting/ui";

const meta: Meta<typeof Button> = {
  title: "Atoms/Button",
  component: Button,
  parameters: {
    docs: {
      description: {
        component: "Compact action button for lightweight command triggers.",
      },
    },
  },
  argTypes: {
    label: { control: "text", description: "Human-readable button label." },
    onClick: { control: false, description: "Invoked when the button is activated." },
    tone: { control: "select", options: ["default","accent"], description: "Optional semantic emphasis.", table: { defaultValue: { summary: "\"default\"" } } },
    className: { control: "text", description: "Optional caller-owned class name for layout composition." },
  },
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Default: Story = {
  args: {
    label: "Run",
    onClick: fn(),
  },
};
