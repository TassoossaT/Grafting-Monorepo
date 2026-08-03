// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PreviewCard } from "@grafting/ui";

const meta: Meta<typeof PreviewCard> = {
  title: "Molecules/PreviewCard",
  component: PreviewCard,
  parameters: {
    docs: {
      description: {
        component: "Gallery-style tile built from Card, Text, and StatusBadge: a cover image,\ntitle/description, status, tags, and caller-owned actions.",
      },
    },
  },
  argTypes: {
    title: { control: "text", description: "Primary human-readable title." },
    description: { control: "text", description: "Optional secondary description." },
    cover: { control: "object", description: "Optional cover image shown above the title, clipped to the card's own\ncorners. `alt` is bundled with `src` so accessible text can never be\nforgotten when a cover is present." },
    status: { control: "select", options: ["neutral","info","success","warning","error"], description: "Optional semantic status." },
    statusLabel: { control: "text", description: "Human-readable label paired with status." },
    tags: { control: "object", description: "Optional short caller-owned labels rendered as compact badges.", table: { defaultValue: { summary: "[]" } } },
    actions: { control: false, description: "Optional actions rendered at the bottom of the card." },
    ariaLabel: { control: "text", description: "Optional accessible name for the card container." },
    className: { control: "text", description: "Optional caller-owned class name for layout composition." },
    glowColor: { control: "text", description: "Optional glow color rendered as an outer shadow, e.g. to signal live status." },
    interactive: { control: "boolean", description: "Whether the card should communicate pointer interaction.", table: { defaultValue: { summary: "false" } } },
    selected: { control: "boolean", description: "Whether the card displays its selected treatment.", table: { defaultValue: { summary: "false" } } },
    selectedColor: { control: "text", description: "Optional boundary color used when the card is selected." },
    accentColor: { control: "text", description: "Optional accent used for the card boundary." },
    backgroundColor: { control: "text", description: "Optional background color for the card surface.", table: { defaultValue: { summary: "\"#ffffff\"" } } },
    fillContainer: { control: "boolean", description: "Whether the card occupies the complete width and height of its container.", table: { defaultValue: { summary: "false" } } },
  },
};
export default meta;

type Story = StoryObj<typeof PreviewCard>;

export const Default: Story = {
  args: {
    title: "Heightmap generation",
    description: "Perlin-noise procedural terrain heightmap, computed in Rust via Wasm.",
    cover: { src: "/preview.png", alt: "Rendered heightmap preview" },
    status: "success",
    statusLabel: "Adopted",
    tags: ["MIT", "top pick"],
  },
};
