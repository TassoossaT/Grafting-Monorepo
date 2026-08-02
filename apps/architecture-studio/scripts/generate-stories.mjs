// Generates one real Storybook story file per @grafting/ui component from
// the already-generated docs/generated/meshes/ui-doc-mesh.v1.json (itself
// produced by packages/ui/scripts/export-doc-mesh.mjs, which reads
// @layer/@status/@example TSDoc tags plus real prop types directly from
// that package's own src/index.ts -- there is no separate metadata file).
//
// This script -- and the stories/ it generates -- deliberately live here in
// apps/architecture-studio, not inside packages/ui: that package must stay
// entirely unaware that Storybook exists (DEC-049/ADR-0011, package
// autonomy). packages/ui only produces the generic, tool-agnostic mesh
// JSON; this app is the one Storybook-aware consumer that turns it into
// real story files. Each example's already-authored JSX snippet is emitted
// verbatim as that story's render body -- snippets must be self-contained
// (no free variables), since a snippet that only makes sense with implied
// surrounding code is not usable as real documentation either.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = join(scriptDir, "..");
const workspaceRoot = join(appRoot, "..", "..");
const meshPath = join(workspaceRoot, "docs", "generated", "meshes", "ui-doc-mesh.v1.json");
const storiesDir = join(appRoot, "stories");

const checkOnly = process.argv.includes("--check");

function toPascalCase(kebabOrSnake) {
  return kebabOrSnake
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join("");
}

function titleForLayer(layer) {
  const pascal = toPascalCase(layer);
  return `${pascal}s`;
}

function loadMesh() {
  const raw = readFileSync(meshPath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== "ui-doc-mesh/v1") {
    throw new Error("ui-doc-mesh schemaVersion must be 'ui-doc-mesh/v1'");
  }
  return parsed.components;
}

function renderStoryFile(component) {
  const { id, name, layer, examples } = component;
  const slug = id.split(".").pop();
  const title = `${titleForLayer(layer)}/${name}`;

  const stories = examples
    .map((example) => {
      const storyName = toPascalCase(example.id);
      return `export const ${storyName}: Story = {
  name: ${JSON.stringify(example.title)},
  render: () => ${example.snippet},
};`;
    })
    .join("\n\n");

  const content = `// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status/@example TSDoc tags in packages/ui/src/index.ts, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ${name} } from "@grafting/ui";

const meta: Meta<typeof ${name}> = {
  title: ${JSON.stringify(title)},
  component: ${name},
};
export default meta;

type Story = StoryObj<typeof ${name}>;

${stories}
`;

  return { slug, content };
}

const components = loadMesh();
const generated = components.map(renderStoryFile);

if (checkOnly) {
  const existing = new Map(
    readdirSync(storiesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".stories.tsx"))
      .map((entry) => [entry.name, readFileSync(join(storiesDir, entry.name), "utf8")]),
  );
  const expectedNames = new Set(generated.map(({ slug }) => `${slug}.stories.tsx`));
  const problems = [];

  for (const { slug, content } of generated) {
    const fileName = `${slug}.stories.tsx`;
    if (!existing.has(fileName)) {
      problems.push(`missing: ${fileName}`);
    } else if (existing.get(fileName) !== content) {
      problems.push(`stale: ${fileName}`);
    }
  }
  for (const fileName of existing.keys()) {
    if (!expectedNames.has(fileName)) problems.push(`unexpected: ${fileName}`);
  }

  if (problems.length > 0) {
    console.error("Storybook stories are out of date with docs/generated/meshes/ui-doc-mesh.v1.json:");
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error("Run: node scripts/generate-stories.mjs (from apps/architecture-studio)");
    process.exit(1);
  }
  console.log("Storybook stories are up to date.");
  process.exit(0);
}

rmSync(storiesDir, { recursive: true, force: true });
mkdirSync(storiesDir, { recursive: true });
for (const { slug, content } of generated) {
  writeFileSync(join(storiesDir, `${slug}.stories.tsx`), content, "utf8");
}
console.log(`Generated ${generated.length} Storybook story file(s) in ${storiesDir}`);
