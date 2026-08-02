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
  // Autodocs was tried and reverted: it triggers a confirmed, currently
  // unresolved upstream Storybook bug (storybookjs/storybook#33440,
  // "docsParameter.renderer is not a function") that throws whenever a
  // Docs page is prepared, including in the background even while just
  // viewing a story's Canvas. Descriptions are rendered directly inside
  // each story's Canvas instead (see generate-stories.mjs's
  // renderDescriptionBlock), which depends on nothing Storybook-internal
  // and cannot be broken by this bug.
  async viteFinal(viteConfig) {
    // Explicit alias to packages/ui's own TypeScript source, not its built
    // dist/. Vite transpiles it on the fly, which is what lets Storybook's
    // own docgen (react-docgen-typescript) read real prop types and TSDoc
    // comments directly -- the compiled dist/index.js still carries each
    // component's own leading comment (TS preserves JSDoc in JS emit by
    // default), but every Props interface and its per-field comments are
    // erased entirely at compile time, so docgen had nothing to read
    // through that path. This does mean Storybook now exercises source
    // rather than the built package; it no longer requires
    // `pnpm --filter @grafting/ui build` to run first.
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias,
      "@grafting/ui": fileURLToPath(new URL("../../../packages/ui/src/index.ts", import.meta.url)),
    };
    return viteConfig;
  },
};

export default config;
