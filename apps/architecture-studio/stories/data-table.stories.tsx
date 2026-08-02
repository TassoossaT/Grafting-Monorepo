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
  parameters: {
    docs: {
      description: {
        component: "Immutable rows table with controlled selection and custom renderers.",
      },
    },
  },
  argTypes: {
    rows: { control: "object", description: "Immutable caller-owned rows." },
    columns: { control: "object", description: "Immutable vendor-neutral column definitions." },
    rowKey: { control: false, description: "Returns the stable key for a row." },
    ariaLabel: { control: "text", description: "Accessible table name." },
    selection: { control: false, description: "Optional controlled selection." },
    pagination: { control: false, description: "Optional pagination, or false to render all rows.", table: { defaultValue: { summary: "{ pageSize: 20, hideWhenSinglePage: true }" } } },
    density: { control: "select", options: ["compact","regular"], description: "Optional table density.", table: { defaultValue: { summary: "\"compact\"" } } },
    emptyMessage: { control: "text", description: "Optional text shown when there are no rows.", table: { defaultValue: { summary: "\"No data\"" } } },
    loading: { control: "boolean", description: "Whether a loading treatment is displayed." },
    className: { control: "text", description: "Optional caller-owned class name for layout composition." },
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
