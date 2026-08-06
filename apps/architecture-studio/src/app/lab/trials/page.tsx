import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseResearchRegistry } from "../../../research-registry.ts";
import TrialsClient from "./trials-client.tsx";

// Server Component: reads the registry directly at render time, same
// rationale as /registry's page.tsx (research-registry.ts's own header).
const REGISTRY_PATH = resolve(process.cwd(), "..", "..", "docs", "research", "RESEARCH-DECISIONS-REGISTRY.md");

export default function TrialsPage() {
  const markdown = readFileSync(REGISTRY_PATH, "utf8");
  const sections = parseResearchRegistry(markdown);
  return <TrialsClient sections={sections} />;
}
