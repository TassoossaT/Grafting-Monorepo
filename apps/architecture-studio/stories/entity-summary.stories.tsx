// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status/@example TSDoc tags in packages/ui/src/index.ts, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { EntitySummary } from "@grafting/ui";

const meta: Meta<typeof EntitySummary> = {
  title: "Molecules/EntitySummary",
  component: EntitySummary,
};
export default meta;

type Story = StoryObj<typeof EntitySummary>;

export const EntityCard: Story = {
  name: "Entity card",
  render: () => <EntitySummary title="architecture-studio" description="project" />,
};
