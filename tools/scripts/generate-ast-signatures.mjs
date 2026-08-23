// Derived AST & API signature map generator for Grafting Monorepo.
// Shares established shape of generate-repo-map.mjs / generate-api-docs.mjs:
// Plain Node ESM, no dependencies beyond Node built-ins, deterministic output,
// and a --check flag that diffs against the committed file and exits non-zero on drift.

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, relative, join } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const check = process.argv.includes("--check");
const outputPath = resolve(root, "docs/generated/signatures/signatures-map.md");

const readJson = async (relPath) => JSON.parse(await readFile(resolve(root, relPath), "utf8"));

// `.next` is excluded for the same reason as `dist` and `target`, and it is
// the one that actually bit: a developer who has run the VTT app locally has
// `apps/vtt/.next/types/*.d.ts` on disk, so their signatures map picks up
// Next's own generated route and cache typings. CI never builds the app
// before generating, so the committed file and the regenerated one disagreed
// on a machine-local artifact and the staleness check failed with a diff
// nothing in the repository could explain.
async function findFiles(directory, extensions, excludeDirs = ["node_modules", "dist", "target", ".next", ".worktrees", ".nx", ".git", "Generated", "generated", "pkg"]) {
  if (!existsSync(directory)) return [];
  const results = [];
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (excludeDirs.includes(entry.name)) continue;
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findFiles(fullPath, extensions, excludeDirs)));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

function extractTsSignatures(content) {
  const lines = content.split("\n");
  const signatures = [];
  let currentBlock = [];
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("export interface ") ||
      trimmed.startsWith("export type ") ||
      trimmed.startsWith("export class ") ||
      trimmed.startsWith("export enum ") ||
      trimmed.startsWith("export function ") ||
      trimmed.startsWith("export const ") ||
      trimmed.startsWith("export declare ")
    ) {
      if (currentBlock.length > 0) {
        signatures.push(currentBlock.join("\n"));
        currentBlock = [];
      }
      inBlock = true;
      currentBlock.push(trimmed);
      if (trimmed.endsWith(";") || (!trimmed.includes("{") && !trimmed.endsWith("("))) {
        signatures.push(currentBlock.join("\n"));
        currentBlock = [];
        inBlock = false;
      }
    } else if (inBlock) {
      if (currentBlock.length < 8) {
        currentBlock.push(trimmed.length > 0 ? "  " + trimmed : "");
      }
      if (trimmed === "}" || trimmed.endsWith("};") || trimmed.endsWith(");")) {
        signatures.push(currentBlock.join("\n"));
        currentBlock = [];
        inBlock = false;
      }
    }
  }
  if (currentBlock.length > 0) signatures.push(currentBlock.join("\n"));
  return signatures;
}

function extractRustSignatures(content) {
  const lines = content.split("\n");
  const signatures = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("pub struct ") ||
      trimmed.startsWith("pub enum ") ||
      trimmed.startsWith("pub trait ") ||
      trimmed.startsWith("pub fn ") ||
      trimmed.startsWith("pub type ") ||
      trimmed.startsWith("pub const ") ||
      trimmed.startsWith("pub mod ")
    ) {
      // Strip function body or multi-line block details for high density
      const signatureOnly = trimmed.split("{")[0].trim();
      signatures.push(signatureOnly);
    }
  }
  return signatures;
}

function extractCSharpSignatures(content) {
  const lines = content.split("\n");
  const signatures = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith("public class ") ||
      trimmed.startsWith("public struct ") ||
      trimmed.startsWith("public interface ") ||
      trimmed.startsWith("public enum ") ||
      trimmed.startsWith("public delegate ") ||
      trimmed.startsWith("public record ") ||
      trimmed.startsWith("public static ")
    ) {
      const signatureOnly = trimmed.split("{")[0].trim();
      signatures.push(signatureOnly);
    }
  }
  return signatures;
}

async function generate() {
  const graphJson = await readJson("docs/generated/project-graph.json");
  const nodes = graphJson.graph?.nodes ?? graphJson.nodes ?? {};

  const ECOSYSTEM_ORDER = ["lang:rust", "lang:typescript", "lang:csharp"];
  const ECOSYSTEM_LABEL = {
    "lang:rust": "Rust Core & Bridges",
    "lang:typescript": "TypeScript Applications & Packages",
    "lang:csharp": "C# / .NET Interop",
  };

  const projectList = Object.entries(nodes).map(([name, node]) => ({
    name,
    root: node.data?.root ?? ".",
    tags: node.data?.tags ?? [],
    type: node.data?.projectType ?? node.type ?? "library",
  }));

  const lines = [];
  lines.push("<!-- @generated by tools/scripts/generate-ast-signatures.mjs -- do not hand-edit. -->");
  lines.push("# AST & API Signature Map");
  lines.push("");
  lines.push(
    "Derived workspace signature index for AI agents (Tier 2 micro-context). " +
      "Regenerate with `pnpm graph:signatures`; `pnpm graph:signatures:check` fails on drift.",
  );
  lines.push("");

  for (const tag of ECOSYSTEM_ORDER) {
    const matchedProjects = projectList.filter((p) => p.tags.includes(tag)).sort((a, b) => a.name.localeCompare(b.name));
    if (matchedProjects.length === 0) continue;

    lines.push(`## ${ECOSYSTEM_LABEL[tag]}`);
    lines.push("");

    for (const project of matchedProjects) {
      const projPath = resolve(root, project.root);
      lines.push(`### \`${project.name}\` (\`${project.root}\`)`);
      lines.push("");

      let sigs = [];

      if (tag === "lang:typescript") {
        const files = await findFiles(projPath, [".ts", ".d.ts"]);
        for (const file of files) {
          const relFile = relative(projPath, file).replaceAll("\\", "/");
          if (relFile.endsWith(".test.ts") || relFile.endsWith(".spec.ts") || relFile.includes("/tests/") || relFile.startsWith("tests/")) continue;
          const content = await readFile(file, "utf8");
          const extracted = extractTsSignatures(content);
          if (extracted.length > 0) {
            sigs.push(`// ${relFile}\n` + extracted.slice(0, 15).join("\n"));
          }
        }
      } else if (tag === "lang:rust") {
        // Check for public API snapshot first
        const snapshotPath = resolve(projPath, "tests/snapshots/public-api.txt");
        if (existsSync(snapshotPath)) {
          const content = await readFile(snapshotPath, "utf8");
          const snapLines = content.split("\n").filter((l) => l.startsWith("pub ")).slice(0, 35);
          sigs.push("// tests/snapshots/public-api.txt\n" + snapLines.join("\n"));
        } else {
          const files = await findFiles(projPath, [".rs"]);
          for (const file of files) {
            const relFile = relative(projPath, file).replaceAll("\\", "/");
            if (relFile.includes("/tests/") || relFile.startsWith("tests/") || relFile.endsWith("_test.rs")) continue;
            const content = await readFile(file, "utf8");
            const extracted = extractRustSignatures(content);
            if (extracted.length > 0) {
              sigs.push(`// ${relFile}\n` + extracted.slice(0, 15).join("\n"));
            }
          }
        }
      } else if (tag === "lang:csharp") {
        const files = await findFiles(projPath, [".cs"]);
        for (const file of files) {
          const content = await readFile(file, "utf8");
          const extracted = extractCSharpSignatures(content);
          if (extracted.length > 0) {
            const relFile = relative(projPath, file).replaceAll("\\", "/");
            sigs.push(`// ${relFile}\n` + extracted.slice(0, 15).join("\n"));
          }
        }
      }

      if (sigs.length > 0) {
        lines.push("```" + (tag === "lang:typescript" ? "ts" : tag === "lang:rust" ? "rust" : "csharp"));
        lines.push(sigs.join("\n\n"));
        lines.push("```");
      } else {
        lines.push("_No public signatures exported or discovered._");
      }
      lines.push("");
    }
  }

  const rendered = `${lines.join("\n")}\n`;

  const outputDir = resolve(root, "docs/generated/signatures");
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  if (check) {
    if (!existsSync(outputPath)) {
      throw new Error(`signatures-map.md is missing at ${outputPath}; run \`pnpm graph:signatures\``);
    }
    const existing = await readFile(outputPath, "utf8");
    if (existing !== rendered) {
      throw new Error("signatures-map.md is stale; run `pnpm graph:signatures`");
    }
    console.log("signatures-map.md is current.");
  } else {
    await writeFile(outputPath, rendered);
    console.log(`Generated ${outputPath}`);
  }
}

generate().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
