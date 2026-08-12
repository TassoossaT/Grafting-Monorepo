import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import test from "node:test";

const appRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(appRoot, "../..");
const sourceRoot = resolve(appRoot, "src");
const sourceExtensions = new Set([".ts", ".tsx"]);
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\sfrom\s*)?["']([^"']+)["']/g;

const allowedLayers = new Map([
  ["app", new Set(["composition", "widgets", "ui"])],
  ["composition", new Set(["adapters", "ports", "features", "entities", "widgets", "ui"])],
  ["widgets", new Set(["features", "entities", "ui"])],
  ["features", new Set(["ports", "entities", "ui"])],
  ["adapters", new Set(["ports", "entities"])],
  ["entities", new Set(["ui"])],
  ["ports", new Set()],
  ["ui", new Set()],
]);

const toPosix = (path) => path.split(sep).join("/");

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      (entry.name.startsWith(".") ||
        ["dist", "node_modules", "pkg", "target"].includes(entry.name))
    ) {
      continue;
    }
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function importsFrom(source) {
  return [...source.matchAll(importPattern)].map((match) => match[1]);
}

function sourceParts(path) {
  return toPosix(relative(sourceRoot, path)).split("/");
}

function localTarget(importer, specifier) {
  if (specifier.startsWith("@/")) return resolve(sourceRoot, specifier.slice(2));
  if (specifier.startsWith(".")) return resolve(dirname(importer), specifier);
  return null;
}

test("source imports follow the accepted layer direction and slice public APIs", async () => {
  const violations = [];
  for (const importer of await sourceFiles(sourceRoot)) {
    const importerParts = sourceParts(importer);
    const importerLayer = importerParts[0];
    const source = await readFile(importer, "utf8");

    for (const specifier of importsFrom(source)) {
      const target = localTarget(importer, specifier);
      if (target === null) {
        if (
          specifier.startsWith("@grafting/") &&
          importerLayer !== "adapters" &&
          importerLayer !== "ui"
        ) {
          violations.push(`${toPosix(relative(appRoot, importer))}: direct ${specifier}`);
        }
        continue;
      }

      const targetParts = sourceParts(target);
      const targetLayer = targetParts[0];
      if (targetLayer === importerLayer) {
        if (
          (targetLayer === "features" || targetLayer === "entities") &&
          importerParts[1] !== targetParts[1]
        ) {
          violations.push(`${importerParts.join("/")} -> ${targetParts.join("/")}`);
        }
        continue;
      }

      if (!allowedLayers.get(importerLayer)?.has(targetLayer)) {
        violations.push(`${importerParts.join("/")} -> ${targetParts.join("/")}`);
        continue;
      }

      if (
        ["composition", "features", "entities", "widgets", "adapters", "ui"].includes(targetLayer) &&
        targetParts.length > 2
      ) {
        violations.push(`${importerParts.join("/")} deep-imports ${targetParts.join("/")}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("React entry modules do not instantiate external runtimes", async () => {
  const violations = [];
  for (const path of await sourceFiles(resolve(sourceRoot, "app"))) {
    const source = await readFile(path, "utf8");
    if (/new\s+(?:Worker|WebSocket)\s*\(/.test(source)) {
      violations.push(toPosix(relative(appRoot, path)));
    }
    if (importsFrom(source).some((specifier) => /^@grafting\/(?:render|isekai)/.test(specifier))) {
      violations.push(toPosix(relative(appRoot, path)));
    }
  }
  assert.deepEqual(violations, []);
});

test("the initial tabletop has one explicit client entry", async () => {
  const clientModules = [];
  for (const path of await sourceFiles(resolve(sourceRoot, "app"))) {
    const source = await readFile(path, "utf8");
    if (/^["']use client["'];/m.test(source)) {
      clientModules.push(toPosix(relative(sourceRoot, path)));
    }
  }

  assert.deepEqual(clientModules, [
    "app/(tabletop)/table/[tableId]/_client/tabletop-entry.tsx",
  ]);
});

test("reusable projects do not import the VTT application", async () => {
  const violations = [];
  for (const parent of ["libs", "packages"]) {
    for (const path of await sourceFiles(resolve(repositoryRoot, parent))) {
      const source = await readFile(path, "utf8");
      if (
        importsFrom(source).some(
          (specifier) => specifier === "@grafting/vtt" || specifier.startsWith("@grafting/vtt/"),
        )
      ) {
        violations.push(toPosix(relative(repositoryRoot, path)));
      }
    }
  }
  assert.deepEqual(violations, []);
});
