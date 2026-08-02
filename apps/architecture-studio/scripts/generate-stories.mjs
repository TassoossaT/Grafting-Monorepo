// Generates one real Storybook story file per @grafting/ui component from
// the already-generated docs/generated/meshes/ui-doc-mesh.v1.json (itself
// produced by packages/ui/scripts/export-doc-mesh.mjs, which reads
// @layer/@status TSDoc tags on each component plus a per-prop @example tag
// and its reflected type directly from that package's own source files --
// there is no separate metadata file).
//
// This script -- and the stories/ it generates -- deliberately live here in
// apps/architecture-studio, not inside packages/ui: that package must stay
// entirely unaware that Storybook exists (DEC-049/ADR-0011, package
// autonomy). packages/ui only produces the generic, tool-agnostic mesh
// JSON; this app is the one Storybook-aware consumer that turns it into
// real story files.
//
// Each component gets exactly one generated "Default" story, rendered via
// CSF3 args/argTypes instead of a static JSX snippet: argTypes come from
// the mesh's per-prop control classification (string-literal unions become
// a select, boolean/number/text controls follow the prop's own type,
// void-returning callbacks become a logged action), and args are seeded
// from each prop's own @example value. Every other value is then explorable
// live through Storybook's own Controls panel -- there is no need for
// multiple hand-authored example variants per component.
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

// Renders one argTypes entry for a prop. This pipeline already fully
// specifies argTypes for every prop (control kind, options), so Storybook's
// implicit docgen-to-argTypes merge is not something to rely on for
// descriptions either -- the prop's own doc-comment description (captured
// by export-doc-mesh.mjs, independent of whichever source packages/ui's own
// Storybook alias happens to resolve to) is emitted explicitly here instead.
function renderArgType(prop) {
  const parts = [];
  switch (prop.control.kind) {
    case "boolean":
      parts.push(`control: "boolean"`);
      break;
    case "number":
      parts.push(`control: "number"`);
      break;
    case "text":
      parts.push(`control: "text"`);
      break;
    case "select":
      parts.push(`control: "select"`, `options: ${JSON.stringify(prop.control.options)}`);
      break;
    case "object":
      parts.push(`control: "object"`);
      break;
    case "disabled":
    case "action":
      parts.push(`control: false`);
      break;
    default:
      throw new Error(`unknown control kind: ${prop.control.kind}`);
  }
  if (prop.description !== undefined) {
    parts.push(`description: ${JSON.stringify(prop.description)}`);
  }
  if (prop.defaultValue !== undefined) {
    // table.defaultValue.summary is display text, not a live value -- the
    // raw @default expression (real source, possibly multi-line for an
    // object literal) is collapsed to one line for a compact table cell.
    const summary = prop.defaultValue.replace(/\s+/g, " ").trim();
    parts.push(`table: { defaultValue: { summary: ${JSON.stringify(summary)} } }`);
  }
  return `{ ${parts.join(", ")} }`;
}

function renderStoryFile(component) {
  const { id, name, layer, summary, props } = component;
  const slug = id.split(".").pop();
  const title = `${titleForLayer(layer)}/${name}`;
  const needsActionFn = props.some((prop) => prop.control.kind === "action");

  const argTypeLines = props.map((prop) => `    ${prop.name}: ${renderArgType(prop)},`);

  const argLines = props
    .map((prop) => {
      if (prop.control.kind === "action") return `    ${prop.name}: fn(),`;
      if (prop.example !== undefined) return `    ${prop.name}: ${prop.example},`;
      return undefined;
    })
    .filter((line) => line !== undefined);

  const imports = [
    `import type { Meta, StoryObj } from "@storybook/react-vite";`,
    ...(needsActionFn ? [`import { fn } from "storybook/test";`] : []),
    `import { ${name} } from "@grafting/ui";`,
  ].join("\n");

  const metaBody = [
    `  title: ${JSON.stringify(title)},`,
    `  component: ${name},`,
    `  parameters: {`,
    `    docs: {`,
    `      description: {`,
    `        component: ${JSON.stringify(summary)},`,
    `      },`,
    `    },`,
    `  },`,
    ...(argTypeLines.length > 0 ? [`  argTypes: {`, ...argTypeLines, `  },`] : []),
  ].join("\n");

  const defaultStoryBody =
    argLines.length > 0 ? `  args: {\n${argLines.join("\n")}\n  },\n` : "";

  const content = `// GENERATED FILE -- do not edit by hand.
// Source: @layer/@status TSDoc tags on the component plus a per-prop
// @example tag on each field, in packages/ui/src, via
// packages/ui/scripts/export-doc-mesh.mjs (docs/generated/meshes/ui-doc-mesh.v1.json).
// Regenerate: node scripts/generate-stories.mjs (from apps/architecture-studio)
${imports}

const meta: Meta<typeof ${name}> = {
${metaBody}
};
export default meta;

type Story = StoryObj<typeof ${name}>;

export const Default: Story = {
${defaultStoryBody}};
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
