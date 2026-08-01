import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NOTICES_PATH = "THIRD_PARTY_NOTICES.md";
const MARKER_PATTERN = /Adapted from\s+(.+?)\s*\((https?:\/\/\S+?)\)\.?/;
const SKIP_PATTERN =
  /(^|\/)(pnpm-lock\.yaml|Cargo\.lock|uv\.lock)$|\.(png|jpe?g|gif|ico|svg|woff2?|ttf|eot|zip|wasm|dll|exe|pdb|pyc)$/i;

/**
 * Scans already-read file contents for the "Adapted from <project> (<url>)"
 * marker required by THIRD_PARTY_NOTICES.md's convention. Pure and
 * testable without touching disk.
 */
export function findMarkers(fileContents) {
  const markers = [];
  for (const [file, content] of fileContents) {
    const match = MARKER_PATTERN.exec(content);
    if (match) markers.push({ file, project: match[1].trim(), url: match[2].trim() });
  }
  return markers;
}

/** Returns markers whose project name has no corresponding entry in the notices file. */
export function findMissingNotices(markers, noticesContent) {
  return markers.filter((marker) => !noticesContent.includes(marker.project));
}

const listTrackedFiles = (root) =>
  execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

const readTrackedFiles = (root, files) => {
  const entries = [];
  for (const file of files) {
    if (file === NOTICES_PATH || SKIP_PATTERN.test(file)) continue;
    try {
      entries.push([file, readFileSync(resolve(root, file), "utf8")]);
    } catch {
      // unreadable mid-scan (e.g. a submodule gitlink); skip rather than fail the whole check
    }
  }
  return entries;
};

export function main(root = process.cwd()) {
  const fileContents = readTrackedFiles(root, listTrackedFiles(root));
  const markers = findMarkers(fileContents);
  const notices = readFileSync(resolve(root, NOTICES_PATH), "utf8");
  const missing = findMissingNotices(markers, notices);

  if (missing.length > 0) {
    for (const marker of missing) {
      console.error(
        `Grafting third-party notice check: ${marker.file} is marked "Adapted from ${marker.project}" ` +
          `but ${NOTICES_PATH} has no matching entry`,
      );
    }
    return 1;
  }

  console.log(
    `Third-party notice check: ${markers.length} marked file(s), all have a matching notice.`,
  );
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
