// G-DOCS-TYPEDOC-API-REFERENCE / G-DOCS-API-COVERAGE-EXPANSION /
// G-DOCS-API-AUTODISCOVERY-AND-NOISE-FILTER /
// G-DOCS-API-MARKDOWN-FORMAT: a deterministic API-reference extractor,
// same shape as generate-repo-map.mjs/generate-artifact-manifest.mjs
// (generate by default, --check diffs against the committed file and
// exits non-zero on drift). Uses TypeDoc's Node API to convert each
// project's TypeScript source into a reflection tree, then renders a
// flat `### signature` + doc-body Markdown document -- the same shape
// tools/rust-api-docgen already uses for the Rust side, and the shape
// libs/graph/core/tests/snapshots/public-api.txt already proved for this
// repo. Not TypeDoc's own native JSON model: that carries per-node
// bookkeeping (id/variant/flags/kind numbers) that is pure overhead for
// the one real consumer today -- an agent reading the whole file -- and
// Markdown's lower punctuation cost and header structure suit that
// better than JSON's. No HTML site, per the owner's explicit "TypeDoc
// only" scope decision.
//
// Targets are discovered from each project's own project.json (the same
// data Nx itself reads), not a hardcoded list, so a new package/app
// needs no edit here to get covered:
//   - projectType "library": a single entry point, from
//     metadata.publicApi.entryPoint where check-typescript-public-api.mjs
//     already governs it, else falling back to package.json's
//     types/main field if it resolves to a real .ts file;
//   - projectType "application" (no package export surface to speak
//     of): every real .ts module under src/ directly, excluding ambient
//     .d.ts declaration files. This documents internal structure, not a
//     public API surface.
// A project is skipped (not an error) if it has no project.json, isn't
// tagged lang:typescript, or resolves to zero entry points --
// packages/isekai-wasm (compiled wasm-bindgen output only, its own
// package.json says "No domain logic here", and it has no project.json
// at all) falls out naturally rather than needing an explicit exclusion.
//
// An optional positional argument scopes generation to one project.json
// `name` instead of every discovered target (G-DOCS-PER-PROJECT-REGEN-RULE):
// `node tools/scripts/generate-api-docs.mjs ui` regenerates only
// docs/generated/api/ts/ui.api.md. Per PROTOCOL.md, an agent completing a
// task regenerates docs scoped to whatever it touched, not the whole
// repo -- each of the 10 documented projects also has this wired as its
// own `docs-generate`/`docs-check` Nx target, so `nx run ui:docs-generate`
// is the normal way to invoke it. The unscoped, all-targets form (no
// argument, what CI's docs:check chain calls) remains the backstop that
// catches anyone who skipped that step.

import { Application, ReflectionKind } from "typedoc";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const check = process.argv.includes("--check");

// TypeDoc's glob matching (via its own dependency, not Node's fs) rejects
// Windows-style backslash separators in entryPoints/tsconfig/basePath --
// resolve() on Windows returns backslashes, so posix-ify before handing
// paths to the TypeDoc API. Filesystem calls (readFile/writeFile) keep
// the native resolve() form; only TypeDoc-facing options need this.
const toPosix = (path) => path.replaceAll("\\", "/");

async function findTsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTsFiles(entryPath)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function discoverTargets() {
  const projectRoots = [];
  for (const parent of ["packages", "apps"]) {
    const parentPath = resolve(root, parent);
    if (!existsSync(parentPath)) continue;
    for (const entry of await readdir(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectJsonPath = resolve(parentPath, entry.name, "project.json");
      if (existsSync(projectJsonPath)) projectRoots.push(resolve(parentPath, entry.name));
    }
  }

  const targets = [];
  for (const projectRoot of projectRoots) {
    const project = await readJson(resolve(projectRoot, "project.json"));
    if (!(project.tags ?? []).includes("lang:typescript")) continue;
    const tsconfig = resolve(projectRoot, "tsconfig.json");
    if (!existsSync(tsconfig)) continue;

    let entryPoints = [];
    if (project.projectType === "application") {
      entryPoints = await findTsFiles(resolve(projectRoot, "src"));
    } else {
      const declaredEntry = project.metadata?.publicApi?.entryPoint;
      const packageJsonPath = resolve(projectRoot, "package.json");
      const packageJson = existsSync(packageJsonPath) ? await readJson(packageJsonPath) : {};
      const fallbackEntry = packageJson.types ?? packageJson.main;
      const entry = declaredEntry ?? fallbackEntry;
      if (entry && entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        const resolvedEntry = resolve(projectRoot, entry);
        if (existsSync(resolvedEntry)) entryPoints = [resolvedEntry];
      }
    }
    if (entryPoints.length === 0) continue;

    targets.push({
      name: project.name,
      tsconfig,
      entryPoints,
      outputPath: resolve(root, "docs/generated/api/ts", `${project.name}.api.md`),
    });
  }
  return targets;
}

async function convert(target) {
  const app = await Application.bootstrap({
    entryPoints: target.entryPoints.map(toPosix),
    tsconfig: toPosix(target.tsconfig),
    basePath: toPosix(root),
    disableGit: true,
    disableSources: true,
    excludeExternals: true,
    logLevel: "Error",
  });
  const project = await app.convert();
  if (!project) throw new Error(`TypeDoc failed to convert ${target.name}`);
  return project;
}

function commentText(reflection) {
  const summary = reflection.comment?.summary;
  if (!summary || summary.length === 0) return undefined;
  const text = summary
    .map((part) => part.text)
    .join("")
    .trim();
  return text.length > 0 ? text : undefined;
}

// A "module" reflection appears for each file entry point (the
// projectType: "application" case, which lists real .ts files directly
// instead of a single index.ts). TypeDoc names it after the full posix
// relative path from basePath (e.g.
// "apps/architecture-studio/src/canvas-composition") -- reduce that to
// just the file's own basename so it reads as a normal path segment
// instead of repeating the whole path in every descendant's name.
function pathSegmentName(reflection) {
  if (!reflection.kindOf?.(ReflectionKind.Module)) return reflection.name;
  return reflection.name.split("/").pop();
}

function qualifiedName(reflection, project, rootName) {
  const parts = [];
  for (let current = reflection; current && current !== project; current = current.parent) {
    parts.unshift(pathSegmentName(current));
  }
  return [rootName, ...parts].join(".");
}

function renderParameters(parameters) {
  if (!parameters || parameters.length === 0) return "";
  return parameters
    .map((parameter) => `${parameter.name}${parameter.flags?.isOptional ? "?" : ""}: ${parameter.type?.toString() ?? "unknown"}`)
    .join(", ");
}

// Walks every exported declaration (containers like interface/class/enum
// AND their members) into one flat list of { signature, doc } entries --
// same flat shape as tools/rust-api-docgen's `items` map, so a container
// (e.g. `interface CardProps`) and each of its members (`CardProps.
// accentColor: string`) both get their own entry with their own doc,
// instead of a nested tree an agent has to walk to find the doc it wants.
function collectEntries(reflection, project, rootName, entries) {
  const kindName = ReflectionKind[reflection.kind]?.toLowerCase() ?? "declaration";
  const name = qualifiedName(reflection, project, rootName);
  const doc = commentText(reflection);

  // A per-file module wrapper (see pathSegmentName above) is pure
  // structure, not signal, unless someone actually wrote a file-level
  // doc comment on it -- skip the entry but still recurse through its
  // children, the same "transparent grouping" treatment the Project root
  // itself already gets in renderMarkdown.
  if (reflection.kindOf?.(ReflectionKind.Module) && !doc) {
    for (const child of reflection.children ?? []) {
      if (child.kindOf?.(ReflectionKind.TypeParameter)) continue;
      collectEntries(child, project, rootName, entries);
    }
    return;
  }

  if (reflection.signatures && reflection.signatures.length > 0) {
    for (const signature of reflection.signatures) {
      const signatureText = `${kindName} ${name}(${renderParameters(signature.parameters)}): ${signature.type?.toString() ?? "unknown"}`;
      entries.push({ signature: signatureText, doc: commentText(signature) ?? doc });
    }
  } else if (reflection.kindOf?.(ReflectionKind.TypeAlias) && reflection.type) {
    entries.push({ signature: `type ${name} = ${reflection.type.toString()}`, doc });
  } else if (reflection.type) {
    const optional = reflection.flags?.isOptional ? "?" : "";
    entries.push({ signature: `${kindName} ${name}${optional}: ${reflection.type.toString()}`, doc });
  } else {
    entries.push({ signature: `${kindName} ${name}`, doc });
  }

  for (const child of reflection.children ?? []) {
    if (child.kindOf?.(ReflectionKind.TypeParameter)) continue;
    collectEntries(child, project, rootName, entries);
  }
}

function renderMarkdown(target, project) {
  const entries = [];
  for (const child of project.children ?? []) {
    collectEntries(child, project, target.name, entries);
  }
  const body = entries
    .map(({ signature, doc }) => (doc ? `### \`${signature}\`\n\n${doc}\n` : `### \`${signature}\`\n`))
    .join("\n");
  return `# ${target.name}\n\n${body}`;
}

async function main() {
  const requestedName = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  let targets = await discoverTargets();
  if (requestedName) {
    targets = targets.filter((target) => target.name === requestedName);
    if (targets.length === 0) {
      throw new Error(`no lang:typescript project named "${requestedName}" was discovered`);
    }
  }
  for (const target of targets) {
    const project = await convert(target);
    const rendered = renderMarkdown(target, project);
    if (check) {
      const existing = existsSync(target.outputPath) ? await readFile(target.outputPath, "utf8") : "";
      if (rendered.trim() !== existing.trim()) {
        throw new Error(`${target.outputPath} is stale; run \`pnpm run docs:api:ts:generate\``);
      }
      console.log(`${target.name}.api.md is current.`);
    } else {
      await writeFile(target.outputPath, `${rendered.trim()}\n`);
      console.log(`Generated ${target.outputPath}`);
    }
  }
}

await main();
