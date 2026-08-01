import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tsModule from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(scriptDir, "..");
const workspaceRoot = join(packageRoot, "..", "..");

const uiIndexPath = join(packageRoot, "src", "index.ts");
const metadataPath = join(packageRoot, "documentation", "mesh", "ui-doc-mesh.meta.v1.json");
const outputPath = join(workspaceRoot, "docs", "generated", "meshes", "ui-doc-mesh.v1.json");
const ts = tsModule?.default ?? tsModule;

const COMPACT_WHITESPACE = /\s+/g;

function normalizeType(typeText) {
  return typeText.replace(COMPACT_WHITESPACE, " ").trim();
}

function toKebabCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function isExported(statement) {
  return (statement.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function parsePropertyName(nameNode) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) {
    return nameNode.text;
  }
  return nameNode.getText();
}

function parsePropsInterfaces(sourceFile) {
  const propsInterfaces = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) || !isExported(statement)) continue;
    const interfaceName = statement.name.text;
    if (!interfaceName.endsWith("Props")) continue;

    const props = [];
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || member.type === undefined || member.name === undefined) {
        continue;
      }

      const propName = parsePropertyName(member.name);
      props.push({
        name: propName,
        type: normalizeType(member.type.getText(sourceFile)),
        required: member.questionToken === undefined,
      });
    }

    propsInterfaces.set(interfaceName, props);
  }

  return propsInterfaces;
}

function parseExportedComponents(sourceFile, propsInterfaces) {
  const components = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(statement) || !isExported(statement) || statement.name === undefined) {
      continue;
    }
    if (statement.parameters.length === 0) continue;

    const componentName = statement.name.text;
    const firstParam = statement.parameters[0];
    if (firstParam.type === undefined) continue;

    const paramTypeText = normalizeType(firstParam.type.getText(sourceFile));
    const basePropsName = paramTypeText.split("<")[0];
    if (!basePropsName.endsWith("Props")) continue;

    const props = propsInterfaces.get(basePropsName);
    if (props === undefined) continue;

    components.push({
      componentName,
      propsName: basePropsName,
      props,
    });
  }

  return components;
}

function loadMetadata() {
  const raw = readFileSync(metadataPath, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed?.schemaVersion !== "ui-doc-mesh-meta/v1") {
    throw new Error("ui-doc-mesh metadata schemaVersion must be 'ui-doc-mesh-meta/v1'");
  }
  if (typeof parsed.components !== "object" || parsed.components === null || Array.isArray(parsed.components)) {
    throw new Error("ui-doc-mesh metadata must contain a components object");
  }
  return parsed.components;
}

function validateMesh(mesh) {
  if (typeof mesh !== "object" || mesh === null) {
    throw new Error("ui-doc-mesh must be a JSON object");
  }
  if (mesh.schemaVersion !== "ui-doc-mesh/v1") {
    throw new Error("ui-doc-mesh schemaVersion must be 'ui-doc-mesh/v1'");
  }
  if (mesh.package !== "@grafting/ui") {
    throw new Error("ui-doc-mesh package must be '@grafting/ui'");
  }
  if (!Array.isArray(mesh.components)) {
    throw new Error("ui-doc-mesh components must be an array");
  }

  for (const component of mesh.components) {
    if (typeof component?.id !== "string" || component.id.length === 0) {
      throw new Error("Each component must have a non-empty string id");
    }
    if (typeof component?.name !== "string" || component.name.length === 0) {
      throw new Error(`Component ${component.id} must have a non-empty string name`);
    }
    if (!Array.isArray(component?.props)) {
      throw new Error(`Component ${component.id} must declare props as an array`);
    }
    if (!Array.isArray(component?.examples)) {
      throw new Error(`Component ${component.id} must declare examples as an array`);
    }
  }
}

const sourceRaw = readFileSync(uiIndexPath, "utf8");
const sourceFile = ts.createSourceFile(uiIndexPath, sourceRaw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const metadataByComponent = loadMetadata();
const propsInterfaces = parsePropsInterfaces(sourceFile);
const exportedComponents = parseExportedComponents(sourceFile, propsInterfaces);

const components = exportedComponents.map(({ componentName, props }) => {
  const metadata = metadataByComponent[componentName] ?? {};
  const layer = typeof metadata.layer === "string" ? metadata.layer : "atom";
  const id = typeof metadata.id === "string" ? metadata.id : `${layer}.${toKebabCase(componentName)}`;
  const summary =
    typeof metadata.summary === "string" && metadata.summary.length > 0
      ? metadata.summary
      : `${componentName} exported by @grafting/ui.`;
  const status = typeof metadata.status === "string" ? metadata.status : "stable";
  const examples = Array.isArray(metadata.examples)
    ? metadata.examples
    : [
        {
          id: `${toKebabCase(componentName)}-default`,
          title: `${componentName} default`,
          snippet: `<${componentName} />`,
        },
      ];

  return {
    id,
    name: componentName,
    layer,
    summary,
    status,
    props,
    examples,
  };
});

const sourceMesh = {
  schemaVersion: "ui-doc-mesh/v1",
  package: "@grafting/ui",
  generatedAt: "source-controlled",
  components,
};

validateMesh(sourceMesh);

const exported = {
  ...sourceMesh,
  generatedAt:
    typeof sourceMesh.generatedAt === "string" && sourceMesh.generatedAt.length > 0
      ? sourceMesh.generatedAt
      : "source-controlled",
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(exported, null, 2)}\n`, "utf8");

console.log(`ui-doc-mesh export: ${uiIndexPath} + ${metadataPath} -> ${outputPath}`);
