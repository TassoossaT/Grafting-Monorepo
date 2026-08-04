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
const VOID_RETURNING_FUNCTION = /=>\s*void\s*$/;

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

// Every doc comment in this pipeline (component-level and now per-prop) is
// parsed here as plain leading trivia -- not via TypeScript's JSDoc tag AST --
// so that JSX/arrow-function expressions inside a fenced ```tsx block never
// risk being mangled by a comment parser that was not designed to carry them
// verbatim.
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
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n");
}

function parseDocBlocks(strippedText) {
  const blocks = [];
  let current = { tag: null, lines: [] };

  for (const line of strippedText.split(/\r?\n/)) {
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

function parseComponentDoc(rawComment, componentName) {
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

  return {
    summary: description.length > 0 ? description : `${componentName} exported by @grafting/ui.`,
    layer,
    status,
  };
}

// The plain description text on a prop's own doc comment (everything before
// its first @tag) becomes that prop's Storybook argType `description` --
// generated explicitly rather than left to Storybook's own docgen-to-argTypes
// merge, since every prop already gets a fully explicit argTypes entry
// (control kind, options) from this pipeline; relying on an implicit merge
// with whatever docgen also produces is not something worth guessing at.
function parsePropDescription(blocks) {
  const description = blocks
    .filter((block) => block.tag === null)
    .flatMap((block) => block.lines)
    .join("\n")
    .trim();
  return description.length > 0 ? description : undefined;
}

// Both @example (a prop's Storybook seed value) and @default (the value the
// component itself substitutes when the prop is omitted -- not always the
// same thing: e.g. Card.borderRadius has no @example seed since it isn't
// required, but does have a real @default of 8) share one grammar: a real
// source expression (string, number, array, arrow function, even JSX)
// rather than a JSON-restricted literal, spliced verbatim wherever it lands.
// Short values read inline (`@default 12`); anything spanning multiple
// lines needs a fenced ```tsx block.
function parseTaggedExpression(blocks, tagName, propName) {
  const tagBlock = blocks.find((block) => block.tag === tagName);
  if (tagBlock === undefined) return undefined;

  const [firstLine = "", ...rest] = tagBlock.lines;
  if (rest.every((line) => line.trim().length === 0)) {
    return firstLine.trim();
  }

  const body = [firstLine, ...rest].join("\n");
  const fenced = FENCED_CODE_BLOCK.exec(body);
  if (fenced === null) {
    throw new Error(
      `@${tagName} on prop "${propName}" must be inline or contain a fenced \`\`\`tsx code block`,
    );
  }
  return fenced[1].trim();
}

// Classifies a prop into a Storybook control so argTypes/Controls can be
// generated straight from the type the package already declares, with no
// docgen step and no separate manual description of each control. A
// function type is only ever auto-wrapped as a logging "action" when it
// returns void -- anything else (e.g. DataTableProps.rowKey, whose return
// value the table actually depends on) must supply its own @example instead,
// since an action wrapper would silently return undefined. Arrays and plain
// object types (DataTableProps.rows/columns, GridLayoutProps.panels, etc.)
// get Storybook's real "object" control -- a JSON tree editor that lets a
// caller add/remove/rename entries live -- rather than being left
// uncontrolled; only ReactNode is excluded from that (it is routinely a real
// JSX element, which a JSON editor cannot usefully represent), and a
// non-void function stays uncontrolled for the reason above.
function classifyControl(checker, member, typeText) {
  if (typeText === "boolean") return { kind: "boolean" };
  if (typeText === "number") return { kind: "number" };
  if (typeText === "string") return { kind: "text" };
  if (typeText.includes("=>")) {
    return VOID_RETURNING_FUNCTION.test(typeText) ? { kind: "action" } : { kind: "disabled" };
  }
  if (typeText === "ReactNode") return { kind: "disabled" };

  if (member.type !== undefined) {
    const resolved = checker.getTypeFromTypeNode(member.type);
    const constituents = resolved.isUnion() ? resolved.types : [resolved];
    if (constituents.length > 0 && constituents.every((constituent) => constituent.isStringLiteral())) {
      return { kind: "select", options: constituents.map((constituent) => constituent.value) };
    }
  }

  return { kind: "object" };
}

function parsePropsInterface(checker, sourceFile, interfaceDeclaration) {
  const props = [];

  for (const member of interfaceDeclaration.members) {
    if (!ts.isPropertySignature(member) || member.type === undefined || member.name === undefined) {
      continue;
    }

    const name = parsePropertyName(member.name);
    const type = normalizeType(member.type.getText(sourceFile));
    const required = member.questionToken === undefined;

    const rawComment = getLeadingDocComment(sourceFile.text, member);
    const blocks = rawComment === undefined ? [] : parseDocBlocks(stripCommentDelimiters(rawComment));
    const example = parseTaggedExpression(blocks, "example", name);
    const defaultValue = parseTaggedExpression(blocks, "default", name);
    const description = parsePropDescription(blocks);

    if (required && example === undefined) {
      throw new Error(
        `required prop "${name}" on ${interfaceDeclaration.name.text} must have an @example value`,
      );
    }

    // Storybook's "object" control initializes its own editable state to {}
    // when no seed value is given in args -- for an optional prop that is
    // meant to stay entirely absent unless the caller opts in (e.g.
    // DataTableProps.selection, whose consuming code assumes it is either
    // undefined or fully well-formed), that synthesized {} is a real prop
    // value the component was never designed to receive. Only grant the
    // "object" control when there is a real @example to seed it with;
    // otherwise leave it uncontrolled, same as any other unrepresentable type.
    const rawControl = classifyControl(checker, member, type);
    const control = rawControl.kind === "object" && example === undefined ? { kind: "disabled" } : rawControl;

    props.push({
      name,
      type,
      required,
      control,
      ...(description === undefined ? {} : { description }),
      ...(example === undefined ? {} : { example }),
      ...(defaultValue === undefined ? {} : { defaultValue }),
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
  const diagnosticsHost = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => packageRoot,
    getNewLine: () => "\n",
  };
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext([config.error], diagnosticsHost));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot, {}, tsconfigPath);
  if (parsed.errors.length > 0) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, diagnosticsHost));
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
          propsInterfacesByName.set(
            exportedName,
            parsePropsInterface(checker, declarationSourceFile, declaration),
          );
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
        ? parseComponentDoc("/***/", componentName)
        : parseComponentDoc(rawComment, componentName);

    components.push({
      id: `${doc.layer}.${toKebabCase(componentName)}`,
      name: componentName,
      layer: doc.layer,
      summary: doc.summary,
      status: doc.status,
      props,
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
    for (const prop of component.props) {
      if (typeof prop?.control?.kind !== "string") {
        throw new Error(`Component ${component.id} prop "${prop?.name}" must declare a control kind`);
      }
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
