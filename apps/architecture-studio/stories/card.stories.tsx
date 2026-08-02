// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "@grafting/ui";

const meta: Meta<typeof Card> = {
  title: "Atoms/Card",
  component: Card,
  parameters: {
    docs: {
      description: {
        component: "Dependency-free bounded surface with replaceable accent and selection styles.",
      },
    },
  },
  argTypes: {
    shape: { control: "select", options: ["rectangle","pill","circle","hexagon"], description: "Geometric outline of the card; defaults to a rounded rectangle.", table: { defaultValue: { summary: "\"rectangle\"" } } },
    children: { control: false, description: "Caller-owned content rendered inside the card." },
    ariaLabel: { control: "text", description: "Optional accessible name for the card." },
    accentColor: { control: "text", description: "Optional accent used for the card boundary." },
    backgroundColor: { control: "text", description: "Optional background color for the card surface.", table: { defaultValue: { summary: "\"#ffffff\"" } } },
    fillContainer: { control: "boolean", description: "Whether the card occupies the complete width and height of its container.", table: { defaultValue: { summary: "false" } } },
    interactive: { control: "boolean", description: "Whether the card should communicate pointer interaction.", table: { defaultValue: { summary: "false" } } },
    selected: { control: "boolean", description: "Whether the card displays its selected treatment.", table: { defaultValue: { summary: "false" } } },
    selectedColor: { control: "text", description: "Optional boundary color used when the card is selected." },
    borderWidth: { control: "number", description: "Optional boundary width in CSS pixels.", table: { defaultValue: { summary: "1" } } },
    borderRadius: { control: "number", description: "Optional rounded-corner radius in CSS pixels.", table: { defaultValue: { summary: "8" } } },
    padding: { control: "number", description: "Optional padding in CSS pixels.", table: { defaultValue: { summary: "12" } } },
    glowColor: { control: "text", description: "Optional glow color rendered as an outer shadow, e.g. to signal live status." },
    className: { control: "text", description: "Optional caller-owned class name for layout composition." },
  },
};
export default meta;

type Story = StoryObj<typeof Card>;

export const Default: Story = {
  args: {
    children: "Body",
    ariaLabel: "Task status",
  },
};
