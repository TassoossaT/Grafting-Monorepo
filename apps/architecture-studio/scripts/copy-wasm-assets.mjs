// Copies each wasm-pack "web" target output this app consumes into its own
// public/<name>/ static-asset folder, so Next.js serves them without any
// Wasm bundler plugin. Each worker that needs one loads it at runtime via a
// webpackIgnore-guarded dynamic import, mirroring
// spikes/wasm-worker-nextjs's already-proven pattern.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptDir, "..");
const workspaceRoot = join(appRoot, "..", "..");

const packages = [
  {
    source: join(workspaceRoot, "packages", "isekai-wasm", "pkg"),
    destination: join(appRoot, "public", "wasm-pkg"),
    buildHint: "pnpm exec nx run isekai-wasm-bridge:build",
  },
  {
    source: join(workspaceRoot, "packages", "vtt-generation-wasm", "pkg"),
    destination: join(appRoot, "public", "vtt-generation-wasm-pkg"),
    buildHint: "pnpm exec nx run generation-wasm:build",
  },
];

for (const { source, destination, buildHint } of packages) {
  if (!existsSync(source)) {
    console.error(`copy-wasm-assets: ${source} does not exist. Run \`${buildHint}\` first.`);
    process.exit(1);
  }
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
  console.log(`copy-wasm-assets: copied ${source} -> ${destination}`);
}
