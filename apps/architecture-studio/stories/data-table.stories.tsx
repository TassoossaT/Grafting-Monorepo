// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status/@example TSDoc tags in packages/ui/src/index.ts, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataTable } from "@grafting/ui";

const meta: Meta<typeof DataTable> = {
  title: "Organisms/DataTable",
  component: DataTable,
};
export default meta;

type Story = StoryObj<typeof DataTable>;

export const RepositoryNodesTable: Story = {
  name: "Repository nodes table",
  render: () => <DataTable
  ariaLabel="Repository nodes"
  rows={[{ id: "a", name: "architecture-studio" }, { id: "b", name: "ui" }]}
  rowKey={(row) => row.id}
  columns={[{ id: "name", header: "Name", value: (row) => row.name }]}
/>,
};
