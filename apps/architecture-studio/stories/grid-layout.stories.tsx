// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status/@example TSDoc tags in packages/ui/src/index.ts, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { GridLayout } from "@grafting/ui";

const meta: Meta<typeof GridLayout> = {
  title: "Atoms/GridLayout",
  component: GridLayout,
};
export default meta;

type Story = StoryObj<typeof GridLayout>;

export const DashboardGrid: Story = {
  name: "Dashboard grid",
  render: () => <GridLayout
  ariaLabel="Studio dashboard"
  panels={[{ placement: { id: "p1", x: 0, y: 0, width: 12, height: 4 }, content: <div>Panel</div> }]}
/>,
};
