import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseResearchRegistry } from "../../research-registry.ts";
import RegistryClient from "./registry-client.tsx";

// Server Component: reads the registry directly at render time, no
// generated intermediate copy (see research-registry.ts's own header for
// why). process.cwd() is this app's own root (apps/architecture-studio)
// under every way this app is actually started (pnpm --filter ... dev/build).
const REGISTRY_PATH = resolve(process.cwd(), "..", "..", "docs", "research", "RESEARCH-DECISIONS-REGISTRY.md");

export default function RegistryPage() {
  const markdown = readFileSync(REGISTRY_PATH, "utf8");
  const sections = parseResearchRegistry(markdown);
  return <RegistryClient sections={sections} />;
}
