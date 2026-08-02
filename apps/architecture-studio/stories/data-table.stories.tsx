// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataTable } from "@grafting/ui";

const meta: Meta<typeof DataTable> = {
  title: "Organisms/DataTable",
  component: DataTable,
  argTypes: {
    rows: { control: "object" },
    columns: { control: "object" },
    rowKey: { control: false },
    ariaLabel: { control: "text" },
    selection: { control: false },
    pagination: { control: false },
    density: { control: "select", options: ["compact","regular"] },
    emptyMessage: { control: "text" },
    loading: { control: "boolean" },
    className: { control: "text" },
  },
};
export default meta;

type Story = StoryObj<typeof DataTable>;

export const Default: Story = {
  args: {
    rows: [{ id: "a", name: "architecture-studio" }, { id: "b", name: "ui" }],
    columns: [{ id: "name", header: "Name", value: (row) => row.name }],
    rowKey: (row) => row.id,
    ariaLabel: "Repository nodes",
  },
};
