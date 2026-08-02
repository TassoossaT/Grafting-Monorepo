// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status/@example TSDoc tags in packages/ui/src/index.ts, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "@grafting/ui";

const meta: Meta<typeof Card> = {
  title: "Atoms/Card",
  component: Card,
};
export default meta;

type Story = StoryObj<typeof Card>;

export const BasicCard: Story = {
  name: "Basic card",
  render: () => <Card ariaLabel="Task status">Body</Card>,
};
