"use client";

// Storybook is a real, separate process (its own Vite dev server, started
// via `pnpm nx run architecture-studio:storybook`) -- Next.js cannot host
// its bundler/dev-server logic directly. This embeds it via iframe so
// browsing stays inside one Next.js-served tab/nav, rather than opening a
// separate browser tab/window.
//
// The iframe points at a same-origin path (proxied to the real Storybook
// process by next.config.mjs's rewrites()), not the raw http://localhost:6006
// URL: a different port is a different origin to the browser even on the
// same machine, and that cross-origin gap made Storybook's own internal
// manager<->preview postMessage channel throw once nested a second level
// deep inside this iframe -- silently breaking the Actions panel (Controls
// still worked, since it doesn't depend on that channel).
const STORYBOOK_URL = "/storybook-app";

export default function StorybookClient() {
  return (
    <iframe
      src={STORYBOOK_URL}
      title="Storybook"
      style={{ width: "100%", height: "100%", border: "none", flex: "1 1 auto" }}
    />
  );
}
