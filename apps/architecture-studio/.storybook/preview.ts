import type { Preview } from "@storybook/react-vite";
import "react-grid-layout/css/styles.css";

const preview: Preview = {
  parameters: {
    controls: {
      // The Controls addon panel's ArgsTable defaults to a compact
      // (Name/Control only) layout -- `expanded: true` is the addon's own
      // documented parameter for the full table (Name, Description,
      // Default, Control), read via useParameter("controls", {}) in
      // Storybook's own bundled manager code. This is the correct,
      // supported way to see argType descriptions in the Controls panel
      // itself; it needs no Docs page/autodocs at all (which hits a
      // separate, confirmed upstream Storybook bug, storybookjs/storybook
      // issue #33440, unrelated to this).
      expanded: true,
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
