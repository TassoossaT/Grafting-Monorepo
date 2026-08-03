// Shared thresholds/classification for this repository's ".md files should
// route readers to the right place instead of becoming colossal" health
// check. Used by both check-doc-organization.mjs (the manual, repo-wide
// report) and doc-size-reminder.mjs (the PostToolUse reminder for one edited
// file), so the two never drift apart on what counts as "large".

/** A doc past this line count is worth a look -- may be a legitimate reference index, not automatically wrong. */
export const LARGE_THRESHOLD = 500;

/** A doc past this line count is very unlikely to still work as a single document a reader can hold in mind. */
export const COLOSSAL_THRESHOLD = 1500;

// Generated/derived evidence (API references, baseline snapshots) grows
// with the codebase it documents -- that's expected, not a sign an authored
// document needs to route readers elsewhere. Both the manual report and the
// PostToolUse reminder are about authored documents a person or agent is
// meant to read and navigate, so these stay out of scope for either.
const GENERATED_PATTERN = /^docs\/generated\//;
const SNAPSHOT_PATTERN = /\/snapshots\//;

/** Whether a repository-relative path is an authored document this check should consider, as opposed to generated/derived evidence. */
export function isAuthoredDoc(relativePath) {
  return !GENERATED_PATTERN.test(relativePath) && !SNAPSHOT_PATTERN.test(relativePath);
}

export function countLines(text) {
  if (text.length === 0) return 0;
  return text.split("\n").length;
}

/** Classifies a line count against this repository's own thresholds. */
export function classifyDocSize(lineCount) {
  if (lineCount >= COLOSSAL_THRESHOLD) return "colossal";
  if (lineCount >= LARGE_THRESHOLD) return "large";
  return "ok";
}
