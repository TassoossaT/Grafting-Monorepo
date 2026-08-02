// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status/@example TSDoc tags in packages/ui/src/index.ts, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@grafting/ui";

const meta: Meta<typeof Text> = {
  title: "Atoms/Text",
  component: Text,
};
export default meta;

type Story = StoryObj<typeof Text>;

export const DefaultText: Story = {
  name: "Default text",
  render: () => <Text content="Example label" />,
};
