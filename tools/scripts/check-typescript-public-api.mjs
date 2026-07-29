import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const normalizeText = (value) => `${value.replaceAll("\r\n", "\n").trimEnd()}\n`;

const normalizedPathKey = (value) => {
  const absolute = resolve(value);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
};

const hasModifier = (typescript, node, modifierKind) =>
  typescript.canHaveModifiers(node) &&
  (typescript.getModifiers(node) ?? []).some((modifier) => modifier.kind === modifierKind);

const hasDocumentation = (typescript, node) =>
  typescript
    .getJSDocCommentsAndTags(node)
    .filter((comment) => typescript.isJSDoc(comment))
    .some((comment) => {
      const text =
        typeof comment.comment === "string"
          ? comment.comment
          : (comment.comment ?? []).map((part) => part.text ?? "").join("");
      return text.trim().length > 0;
    });

const declarationLabel = (node, sourceFile) => {
  if (node.name) return node.name.getText(sourceFile);
  return node.getText(sourceFile).split(/\r?\n/, 1)[0].slice(0, 100);
};

const publicMembers = (typescript, statement) => {
  let members = [];
  if (
    typescript.isInterfaceDeclaration(statement) ||
    typescript.isClassDeclaration(statement) ||
    typescript.isEnumDeclaration(statement)
  ) {
    members = statement.members;
  } else if (
    typescript.isTypeAliasDeclaration(statement) &&
    typescript.isTypeLiteralNode(statement.type)
  ) {
    members = statement.type.members;
  }

  return members.filter(
    (member) =>
      !(member.name && typescript.isPrivateIdentifier(member.name)) &&
      !hasModifier(typescript, member, typescript.SyntaxKind.PrivateKeyword) &&
      !hasModifier(typescript, member, typescript.SyntaxKind.ProtectedKeyword),
  );
};

const isExportedStatement = (typescript, statement) =>
  typescript.isExportDeclaration(statement) ||
  typescript.isExportAssignment(statement) ||
  hasModifier(typescript, statement, typescript.SyntaxKind.ExportKeyword);

export function collectUndocumentedPublicApi(typescript, sourceFile) {
  const missing = [];

  for (const statement of sourceFile.statements) {
    if (!isExportedStatement(typescript, statement)) continue;

    const exportedLabel = declarationLabel(statement, sourceFile);
    if (!hasDocumentation(typescript, statement)) {
      missing.push(`export ${exportedLabel}`);
    }

    for (const member of publicMembers(typescript, statement)) {
      if (!hasDocumentation(typescript, member)) {
        missing.push(`member ${exportedLabel}.${declarationLabel(member, sourceFile)}`);
      }
    }
  }

  return missing.sort();
}

export function collectModuleSpecifiers(typescript, declarationText) {
  const sourceFile = typescript.createSourceFile(
    "public-api.d.ts",
    declarationText,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const specifiers = new Set();

  const visit = (node) => {
    if (
      (typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      typescript.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      typescript.isImportEqualsDeclaration(node) &&
      typescript.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      typescript.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.add(node.moduleReference.expression.text);
    } else if (
      typescript.isImportTypeNode(node) &&
      typescript.isLiteralTypeNode(node.argument) &&
      typescript.isStringLiteral(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text);
    }
    typescript.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...specifiers].sort();
}

export function assertNoForbiddenModules(moduleSpecifiers, forbiddenModules) {
  const leaks = moduleSpecifiers.filter((specifier) =>
    forbiddenModules.some(
      (forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`),
    ),
  );
  if (leaks.length > 0) {
    throw new Error(`public declaration leaks forbidden module(s): ${leaks.join(", ")}`);
  }
}

export function assertBaselineMatches(expected, actual) {
  if (normalizeText(expected) !== normalizeText(actual)) {
    throw new Error(
      "TypeScript public API drifted; update intentionally and review the baseline diff",
    );
  }
}

export function resolveWithinProject(projectRoot, candidate, label) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`${label} must be a non-empty project-relative path`);
  }
  if (isAbsolute(candidate)) {
    throw new Error(`${label} must be project-relative: ${candidate}`);
  }
  const absolute = resolve(projectRoot, candidate);
  const projectRelative = relative(projectRoot, absolute);
  if (
    projectRelative === ".." ||
    projectRelative.startsWith(`..${sep}`) ||
    isAbsolute(projectRelative)
  ) {
    throw new Error(`${label} must stay inside the project root: ${candidate}`);
  }
  return absolute;
}

export function loadTypeScriptForProject(projectRoot) {
  const projectRequire = createRequire(resolve(projectRoot, "package.json"));
  try {
    return projectRequire("typescript");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot load the project's pinned TypeScript; install the workspace dependencies first: ${reason}`,
    );
  }
}

const formatDiagnostics = (typescript, diagnostics, projectRoot) =>
  typescript.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => projectRoot,
    getNewLine: () => "\n",
  });

const emitPublicDeclaration = (typescript, projectRoot, packageManifest, contract) => {
  const tsconfigPath = resolve(projectRoot, "tsconfig.json");
  const config = typescript.readConfigFile(tsconfigPath, typescript.sys.readFile);
  if (config.error) {
    throw new Error(formatDiagnostics(typescript, [config.error], projectRoot));
  }

  const parsed = typescript.parseJsonConfigFileContent(
    config.config,
    typescript.sys,
    projectRoot,
    {
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,
      incremental: false,
      noEmit: false,
      noEmitOnError: true,
      sourceMap: false,
    },
    tsconfigPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(formatDiagnostics(typescript, parsed.errors, projectRoot));
  }

  const program = typescript.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = typescript.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    throw new Error(formatDiagnostics(typescript, diagnostics, projectRoot));
  }

  const sourceEntryPath = resolveWithinProject(projectRoot, contract.entryPoint, "entryPoint");
  const sourceEntry = program.getSourceFile(sourceEntryPath);
  if (!sourceEntry) {
    throw new Error(
      `public API entry point is not part of the TypeScript program: ${contract.entryPoint}`,
    );
  }
  const undocumented = collectUndocumentedPublicApi(typescript, sourceEntry);
  if (undocumented.length > 0) {
    throw new Error(`public API documentation is missing:\n- ${undocumented.join("\n- ")}`);
  }

  const outputs = new Map();
  const emitResult = program.emit(
    undefined,
    (fileName, data) => outputs.set(normalizedPathKey(fileName), normalizeText(data)),
    undefined,
    true,
  );
  if (emitResult.diagnostics.length > 0 || emitResult.emitSkipped) {
    throw new Error(formatDiagnostics(typescript, emitResult.diagnostics, projectRoot));
  }

  if (typeof packageManifest.types !== "string" || packageManifest.types.length === 0) {
    throw new Error("package.json must declare the public declaration entry through 'types'");
  }
  const declarationPath = resolveWithinProject(
    projectRoot,
    packageManifest.types,
    "package.json#types",
  );
  const declaration = outputs.get(normalizedPathKey(declarationPath));
  if (!declaration) {
    const emitted = [...outputs.keys()].map((output) => relative(projectRoot, output)).join(", ");
    throw new Error(
      `TypeScript did not emit package.json#types (${packageManifest.types}); emitted: ${emitted}`,
    );
  }

  return declaration;
};

const renderBaseline = ({ packageName, typescriptVersion, contract, declaration }) => {
  const forbidden = contract.forbiddenModules.length
    ? contract.forbiddenModules.map((module) => `\`${module}\``).join(", ")
    : "none";
  return normalizeText(`# Generated TypeScript public API baseline

Package: \`${packageName}\`  
TypeScript: \`${typescriptVersion}\`  
Source entry point: \`${contract.entryPoint}\`  
Documentation policy: every exported declaration and public member requires TSDoc  
Forbidden public modules: ${forbidden}

## Declaration entry point

\`\`\`ts
${declaration.trimEnd()}
\`\`\`
`);
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const updateRequested = () =>
  ["1", "yes", "true"].includes((process.env.UPDATE_SNAPSHOTS ?? "").toLowerCase());

export async function checkTypeScriptPublicApi(projectArgument) {
  if (!projectArgument) {
    throw new Error("usage: node tools/scripts/check-typescript-public-api.mjs <project-root>");
  }

  const projectRoot = resolve(projectArgument);
  const packageManifest = await readJson(resolve(projectRoot, "package.json"));
  const projectManifest = await readJson(resolve(projectRoot, "project.json"));
  const metadata = projectManifest.metadata?.publicApi;
  if (!metadata) {
    throw new Error("project.json must declare metadata.publicApi");
  }
  if (metadata.forbiddenModules !== undefined && !Array.isArray(metadata.forbiddenModules)) {
    throw new Error("metadata.publicApi.forbiddenModules must be an array");
  }
  const contract = {
    entryPoint: metadata.entryPoint,
    baseline: metadata.baseline,
    forbiddenModules: [...(metadata.forbiddenModules ?? [])].sort(),
  };
  const entryPointPath = resolveWithinProject(projectRoot, contract.entryPoint, "entryPoint");
  const baselinePath = resolveWithinProject(projectRoot, contract.baseline, "baseline");
  if (!existsSync(entryPointPath)) {
    throw new Error(`public API entry point does not exist: ${contract.entryPoint}`);
  }

  const typescript = loadTypeScriptForProject(projectRoot);
  const declaration = emitPublicDeclaration(typescript, projectRoot, packageManifest, contract);
  const moduleSpecifiers = collectModuleSpecifiers(typescript, declaration);
  assertNoForbiddenModules(moduleSpecifiers, contract.forbiddenModules);
  const baseline = renderBaseline({
    packageName: packageManifest.name,
    typescriptVersion: typescript.version,
    contract,
    declaration,
  });

  if (updateRequested()) {
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, baseline, "utf8");
    console.log(`Updated TypeScript public API baseline: ${relative(process.cwd(), baselinePath)}`);
    return;
  }

  const expected = await readFile(baselinePath, "utf8").catch((error) => {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
    throw new Error(
      "tracked TypeScript public API baseline is missing; run the documented update command",
    );
  });
  assertBaselineMatches(expected, baseline);
  console.log(
    `TypeScript public API baseline is current for ${packageManifest.name}; no forbidden module leaked`,
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  checkTypeScriptPublicApi(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
