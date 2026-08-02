"use client";

// Storybook is a real, separate process (its own Vite dev server, started
// via `pnpm nx run architecture-studio:storybook`) -- Next.js cannot host
// its bundler/dev-server logic directly. This embeds it via iframe so
// browsing stays inside one Next.js-served tab/nav, rather than opening a
// separate browser tab/window.
const STORYBOOK_URL = "http://localhost:6006";

export default function StorybookClient() {
  return (
    <iframe
      src={STORYBOOK_URL}
      title="Storybook"
      style={{ width: "100%", height: "100%", border: "none", flex: "1 1 auto" }}
    />
  );
}
