// Manual, on-demand health check for this repository's Markdown documents:
// reports every Git-tracked .md file that has grown "large" or "colossal"
// (thresholds in doc-size.mjs), so an oversized doc gets noticed and split
// into a router plus linked sub-documents instead of silently growing
// forever. Read-only: this script only reports, it never edits a document
// or decides how to split it -- that stays an authored, reviewed decision.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyDocSize, countLines, isAuthoredDoc } from "./doc-size.mjs";

const listTrackedMarkdownFiles = (root) =>
  execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

export function collectDocSizeReport(root) {
  const rows = [];
  for (const relativePath of listTrackedMarkdownFiles(root).filter(isAuthoredDoc)) {
    const lineCount = countLines(readFileSync(resolve(root, relativePath), "utf8"));
    const level = classifyDocSize(lineCount);
    if (level !== "ok") rows.push({ path: relativePath, lineCount, level });
  }
  return rows.sort((a, b) => b.lineCount - a.lineCount);
}

export function main(argv_ = process.argv.slice(2)) {
  const root = resolve(argv_[0] ?? ".");
  const rows = collectDocSizeReport(root);

  if (rows.length === 0) {
    console.log("doc-size: every tracked .md file is under the large-doc threshold.");
    return 0;
  }

  for (const row of rows) {
    console.log(`${row.level === "colossal" ? "COLOSSAL" : "large   "} ${row.lineCount.toString().padStart(6)} lines  ${row.path}`);
  }
  const colossalCount = rows.filter((row) => row.level === "colossal").length;
  console.log(
    `\n${rows.length} document(s) flagged (${colossalCount} colossal). This is a report, not a ` +
      "gate -- a large reference index can be legitimate; a colossal one usually isn't. Consider " +
      "splitting into a short router plus linked sub-documents.",
  );
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
