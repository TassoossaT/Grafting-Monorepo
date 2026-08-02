import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";

// Storybook and its story files both live in apps/architecture-studio.
// packages/ui itself never references Storybook (DEC-049/ADR-0011): it only
// produces the generic, tool-agnostic docs/generated/meshes/ui-doc-mesh.v1.json;
// scripts/generate-stories.mjs (in this app) is the one Storybook-aware
// consumer that turns that JSON into real story files under stories/.
const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  addons: [],
  async viteFinal(viteConfig) {
    // Explicit alias to packages/ui's built dist/, rather than relying on
    // Node's self-reference resolution, which is a real but less
    // universally predictable resolution path across bundlers. packages/ui
    // must be built (`pnpm --filter @grafting/ui build`) before Storybook
    // can resolve this.
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias,
      "@grafting/ui": fileURLToPath(new URL("../../../packages/ui/dist/index.js", import.meta.url)),
    };
    return viteConfig;
  },
};

export default config;
