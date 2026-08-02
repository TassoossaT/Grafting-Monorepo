// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status/@example TSDoc tags in packages/ui/src/index.ts, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusBadge } from "@grafting/ui";

const meta: Meta<typeof StatusBadge> = {
  title: "Atoms/StatusBadge",
  component: StatusBadge,
};
export default meta;

type Story = StoryObj<typeof StatusBadge>;

export const ReadyStatus: Story = {
  name: "Ready status",
  render: () => <StatusBadge status="success" label="Ready" />,
};
