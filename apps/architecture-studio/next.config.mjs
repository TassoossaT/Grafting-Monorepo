/** @type {import("next").NextConfig} */
const nextConfig = {
  // Proxies the standalone Storybook dev server (its own process, its own
  // port -- Next.js cannot host its bundler/dev-server logic directly)
  // through this app's own origin. Storybook's manager UI itself uses only
  // relative asset paths (confirmed by inspecting its served HTML directly:
  // "./sb-manager/runtime.js", "./sb-common-assets/...", not root-absolute
  // paths), so serving it under a subpath resolves those correctly. The
  // point of this proxy is same-origin: the /storybook iframe embedding
  // Storybook cross-port (a different origin to the browser even on the
  // same machine) made Storybook's own manager<->preview postMessage
  // channel throw a SecurityError once nested a second level deep inside
  // this app's own iframe, silently breaking the Actions panel. This does
  // NOT proxy Vite's HMR WebSocket (Next.js rewrites only handle plain HTTP
  // requests) -- editing a story still requires re-running
  // scripts/generate-stories.mjs and a manual browser refresh, same as
  // before; only the actual Controls/Actions functionality is what this fixes.
  //
  // Vite's own dev-server module graph uses many different ROOT-absolute
  // path conventions for its internal/source requests (confirmed directly,
  // one at a time, each 404ing until added: "/@fs/<absolute path>",
  // "/vite-inject-mocker-entry.js", "/.storybook/preview.ts", and there is
  // no reason to expect that list is complete) -- an ES module import or
  // fetch starting with "/" resolves against the origin root, not the
  // current page's own path, so none of these ever go through the
  // /storybook-app/* prefix used by the iframe's own entry point. Enumerating
  // every such path individually is an unbounded whack-a-mole, so instead a
  // `fallback` rewrite (Next's lowest-priority rewrite phase: only applied
  // once neither a real page/route nor a public file in this app matched)
  // proxies anything otherwise unmatched to Storybook's own root. This can
  // never shadow one of this app's own routes -- it only ever fires for a
  // request nothing else claimed.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: "/storybook-app/:path*",
          destination: "http://localhost:6006/:path*",
        },
      ],
      fallback: [
        {
          source: "/:path*",
          destination: "http://localhost:6006/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
