// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "@grafting/ui";

const meta: Meta<typeof StatusBadge> = {
  title: "Atoms/StatusBadge",
  component: StatusBadge,
  argTypes: {
    status: { control: "select", options: ["neutral","info","success","warning","error"] },
    label: { control: "text" },
    className: { control: "text" },
  },
};
export default meta;

type Story = StoryObj<typeof StatusBadge>;

export const Default: Story = {
  args: {
    status: "success",
    label: "Ready",
  },
};
