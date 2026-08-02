import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tsModule from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(scriptDir, "..");
const workspaceRoot = join(packageRoot, "..", "..");

const uiIndexPath = join(packageRoot, "src", "index.ts");
const tsconfigPath = join(packageRoot, "tsconfig.json");
const outputPath = join(workspaceRoot, "docs", "generated", "meshes", "ui-doc-mesh.v1.json");
const ts = tsModule?.default ?? tsModule;

const COMPACT_WHITESPACE = /\s+/g;
const FENCED_CODE_BLOCK = /```(?:tsx|jsx)?\r?\n([\s\S]*?)```/;

function normalizeType(typeText) {
  return typeText.replace(COMPACT_WHITESPACE, " ").trim();
}

function toKebabCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function parsePropertyName(nameNode) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)) {
    return nameNode.text;
  }
  return nameNode.getText();
}

// The doc comment above each exported component function is this pipeline's
// one hand-authored input (summary, @layer, @status, @example snippets). It
// is parsed here as plain leading trivia -- not via TypeScript's JSDoc tag
// AST -- so that JSX inside a fenced ```tsx block never risks being mangled
// by a comment parser that was not designed to carry JSX verbatim.
function getLeadingDocComment(sourceRaw, node) {
  const ranges = ts.getLeadingCommentRanges(sourceRaw, node.getFullStart()) ?? [];
  const jsDocRange = ranges
    .filter((range) => sourceRaw.slice(range.pos, range.pos + 3) === "/**")
    .at(-1);
  return jsDocRange === undefined ? undefined : sourceRaw.slice(jsDocRange.pos, jsDocRange.end);
}

function stripCommentDelimiters(rawComment) {
  return rawComment
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n");
}

function parseDocBlocks(strippedText) {
  const blocks = [];
  let current = { tag: null, lines: [] };

  for (const line of strippedText.split("\n")) {
    const tagMatch = /^@(\w+)(?:[ \t]+(.*))?$/.exec(line);
    if (tagMatch === null) {
      current.lines.push(line);
      continue;
    }
    blocks.push(current);
    current = { tag: tagMatch[1], lines: [tagMatch[2] ?? ""] };
  }
  blocks.push(current);

  return blocks;
}

function parseDocComment(rawComment, componentName) {
  const blocks = parseDocBlocks(stripCommentDelimiters(rawComment));

  const description = blocks
    .filter((block) => block.tag === null)
    .flatMap((block) => block.lines)
    .join("\n")
    .trim();

  const layerBlock = blocks.find((block) => block.tag === "layer");
  const layer = layerBlock === undefined ? "atom" : layerBlock.lines[0].trim();

  const statusBlock = blocks.find((block) => block.tag === "status");
  const status = statusBlock === undefined ? "stable" : statusBlock.lines[0].trim();

  const exampleBlocks = blocks.filter((block) => block.tag === "example");
  const examples = exampleBlocks.map((block) => {
    const title = block.lines[0].trim();
    const body = block.lines.slice(1).join("\n");
    const fenced = FENCED_CODE_BLOCK.exec(body);
    if (fenced === null) {
      throw new Error(`@example "${title}" on ${componentName} must contain a fenced \`\`\`tsx code block`);
    }
    return {
      id: toKebabCase(title),
      title,
      snippet: fenced[1].trim(),
    };
  });

  return {
    summary: description.length > 0 ? description : `${componentName} exported by @grafting/ui.`,
    layer,
    status,
    examples:
      examples.length > 0
        ? examples
        : [{ id: `${toKebabCase(componentName)}-default`, title: `${componentName} default`, snippet: `<${componentName} />` }],
  };
}

function parsePropsInterface(sourceFile, interfaceDeclaration) {
  const props = [];
  for (const member of interfaceDeclaration.members) {
    if (!ts.isPropertySignature(member) || member.type === undefined || member.name === undefined) {
      continue;
    }
    props.push({
      name: parsePropertyName(member.name),
      type: normalizeType(member.type.getText(sourceFile)),
      required: member.questionToken === undefined,
    });
  }
  return props;
}

// index.ts only re-exports; every component's Props interface and its
// documented function live in that component's own file. Resolving through
// the alias (the same mechanism tools/scripts/check-typescript-public-api.mjs
// uses for its documentation check) is what lets this script find them
// without hardcoding a name-to-file map.
function resolveReExportedDeclarations(checker, specifier) {
  const localTarget = checker.getExportSpecifierLocalTargetSymbol(specifier);
  if (localTarget === undefined) return [];
  const resolved =
    (localTarget.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(localTarget) : localTarget;
  return resolved.getDeclarations() ?? [];
}

function loadProgram() {
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext([config.error], {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => packageRoot,
      getNewLine: () => "\n",
    }));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot, {}, tsconfigPath);
  if (parsed.errors.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => packageRoot,
      getNewLine: () => "\n",
    }));
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
}

function collectComponents(checker, indexSourceFile) {
  const propsInterfacesByName = new Map();
  const componentCandidates = [];

  for (const statement of indexSourceFile.statements) {
    const isNamedReExport =
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause);
    if (!isNamedReExport) continue;

    for (const specifier of statement.exportClause.elements) {
      const exportedName = specifier.name.getText(indexSourceFile);
      for (const declaration of resolveReExportedDeclarations(checker, specifier)) {
        const declarationSourceFile = declaration.getSourceFile();
        if (ts.isInterfaceDeclaration(declaration) && exportedName.endsWith("Props")) {
          propsInterfacesByName.set(exportedName, parsePropsInterface(declarationSourceFile, declaration));
        } else if (ts.isFunctionDeclaration(declaration) && declaration.parameters.length > 0) {
          componentCandidates.push({ componentName: exportedName, declaration, declarationSourceFile });
        }
      }
    }
  }

  const components = [];
  for (const { componentName, declaration, declarationSourceFile } of componentCandidates) {
    const firstParam = declaration.parameters[0];
    if (firstParam.type === undefined) continue;
    const paramTypeText = normalizeType(firstParam.type.getText(declarationSourceFile));
    const basePropsName = paramTypeText.split("<")[0];
    if (!basePropsName.endsWith("Props")) continue;

    const props = propsInterfacesByName.get(basePropsName);
    if (props === undefined) continue;

    const rawComment = getLeadingDocComment(declarationSourceFile.text, declaration);
    const doc =
      rawComment === undefined
        ? parseDocComment("/***/", componentName)
        : parseDocComment(rawComment, componentName);
    const layer = doc.layer;

    components.push({
      id: `${layer}.${toKebabCase(componentName)}`,
      name: componentName,
      layer,
      summary: doc.summary,
      status: doc.status,
      props,
      examples: doc.examples,
    });
  }

  return components;
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

const program = loadProgram();
const checker = program.getTypeChecker();
const indexSourceFile = program.getSourceFile(uiIndexPath);
if (indexSourceFile === undefined) {
  throw new Error(`public API entry point is not part of the TypeScript program: ${uiIndexPath}`);
}

const sourceMesh = {
  schemaVersion: "ui-doc-mesh/v1",
  package: "@grafting/ui",
  generatedAt: "source-controlled",
  components: collectComponents(checker, indexSourceFile),
};

validateMesh(sourceMesh);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(sourceMesh, null, 2)}\n`, "utf8");

console.log(`ui-doc-mesh export: ${uiIndexPath} -> ${outputPath}`);
