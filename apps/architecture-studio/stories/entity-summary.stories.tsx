// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { EntitySummary } from "@grafting/ui";

const meta: Meta<typeof EntitySummary> = {
  title: "Molecules/EntitySummary",
  component: EntitySummary,
  parameters: {
    docs: {
      description: {
        component: "Composable identity card built from Card, Text, and StatusBadge.",
      },
    },
  },
  argTypes: {
    title: { control: "text", description: "Primary human-readable entity name." },
    description: { control: "text", description: "Optional secondary description." },
    status: { control: "select", options: ["neutral","info","success","warning","error"], description: "Optional semantic status." },
    statusLabel: { control: "text", description: "Human-readable label paired with status." },
    leading: { control: false, description: "Optional visual placed before the textual identity." },
    actions: { control: false, description: "Optional actions placed after the textual identity." },
    ariaLabel: { control: "text", description: "Optional accessible name for the summary container." },
    className: { control: "text", description: "Optional caller-owned class name for layout composition." },
    accentColor: { control: "text", description: "Optional accent used for the complete card boundary." },
    backgroundColor: { control: "text", description: "Optional background color for the complete card surface." },
    fillContainer: { control: "boolean", description: "Whether the card occupies the complete width and height of its container.", table: { defaultValue: { summary: "false" } } },
    interactive: { control: "boolean", description: "Whether the card should communicate pointer interaction.", table: { defaultValue: { summary: "false" } } },
    selected: { control: "boolean", description: "Whether the card displays its selected treatment.", table: { defaultValue: { summary: "false" } } },
    selectedColor: { control: "text", description: "Optional boundary color used when the component is selected." },
    borderWidth: { control: "number", description: "Optional boundary width in CSS pixels.", table: { defaultValue: { summary: "1" } } },
    borderRadius: { control: "number", description: "Optional rounded-corner radius in CSS pixels.", table: { defaultValue: { summary: "8" } } },
    bodyPadding: { control: "number", description: "Optional body padding in CSS pixels.", table: { defaultValue: { summary: "12" } } },
    contentGap: { control: "number", description: "Optional gap between the component's content regions.", table: { defaultValue: { summary: "10" } } },
    tags: { control: false, description: "Optional short caller-owned labels rendered as compact badges below the identity.", table: { defaultValue: { summary: "[]" } } },
    glowColor: { control: "text", description: "Optional glow color rendered as an outer shadow, e.g. to signal live status." },
    shape: { control: "select", options: ["rectangle","pill","circle","hexagon"], description: "Geometric outline of the card; defaults to a rounded rectangle.", table: { defaultValue: { summary: "\"rectangle\"" } } },
    actionLabel: { control: "text", description: "Optional label for a compact action button rendered in the card." },
    onAction: { control: false, description: "Invoked when the action button is activated." },
  },
};
export default meta;

type Story = StoryObj<typeof EntitySummary>;

export const Default: Story = {
  args: {
    title: "architecture-studio",
    description: "project",
    onAction: fn(),
  },
};
