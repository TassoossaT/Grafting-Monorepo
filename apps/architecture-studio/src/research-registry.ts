// Parses docs/research/RESEARCH-DECISIONS-REGISTRY.md's authored Markdown
// directly -- deliberately not a docs/generated/ pipeline, since this app
// is the only consumer today (DEC-055/ADR-0017's "no intermediate
// generated artifact when a direct read suffices" preference, applied
// here too). Status-cell parsing doubles as this registry's only
// correctness check: an unrecognized status throws, the same guarantee a
// --check script would otherwise give.

/** Canonical status vocabulary, matching the registry's own "Status legend" section. */
export type StatusId =
  | "adopted"
  | "decided"
  | "in-development"
  | "in-review"
  | "standby"
  | "discarded"
  | "reference-only";

interface StatusDefinition {
  readonly id: StatusId;
  readonly label: string;
  /** The exact prefix this status appears as inside a Status table cell. */
  readonly match: string;
}

// Order doesn't matter for correctness (no prefix is a prefix of another
// here), but is kept in the same order as the registry's own legend.
export const STATUS_DEFINITIONS: readonly StatusDefinition[] = [
  { id: "adopted", label: "Adopted", match: "Adopted" },
  { id: "decided", label: "Decided", match: "Decided" },
  { id: "in-development", label: "In development", match: "In development" },
  { id: "in-review", label: "In review", match: "In review" },
  { id: "standby", label: "Standby (deferred)", match: "Standby" },
  { id: "discarded", label: "Discarded", match: "Discarded" },
  { id: "reference-only", label: "Reference only", match: "Reference only" },
];

export interface RegistryRow {
  readonly candidate: string;
  readonly license: string;
  readonly statusId: StatusId;
  readonly statusLabel: string;
  /** Free-text qualifier after the matched status, e.g. "top pick" -- null when the cell was an exact status match. */
  readonly statusQualifier: string | null;
  readonly note: string;
}

export interface RegistrySection {
  readonly title: string;
  /** Repository-relative path to the research document this section summarizes, when the registry names one. */
  readonly sourceDoc: string | null;
  readonly rows: readonly RegistryRow[];
}

const stripInlineMarkdown = (text: string): string => text.replace(/\*\*/g, "").replace(/`/g, "").trim();

const FULL_REASONING_PREFIX = "Full reasoning:";
const BACKTICK_PATH_PATTERN = /`([^`]+)`/;

function parseSourceDoc(line: string): string | null {
  const text = line.slice(FULL_REASONING_PREFIX.length).trim();
  const backtickMatch = BACKTICK_PATH_PATTERN.exec(text);
  // Only treat a backtick span as the real path when it looks like one (no
  // `*` glob, ends in .md) -- otherwise it's prose incidentally quoting a
  // path-shaped string (e.g. "not yet captured in a dedicated `docs/research/*.md` file").
  const looksLikeRealPath = backtickMatch !== null && !backtickMatch[1].includes("*") && backtickMatch[1].endsWith(".md");
  return looksLikeRealPath ? backtickMatch[1] : text || null;
}

function parseStatusCell(
  rawCell: string,
  candidate: string,
): Pick<RegistryRow, "statusId" | "statusLabel" | "statusQualifier"> {
  const cell = stripInlineMarkdown(rawCell);
  const definition = STATUS_DEFINITIONS.find((candidate_) => cell.startsWith(candidate_.match));
  if (!definition) {
    throw new Error(
      `research-registry.ts: unrecognized status "${cell}" for candidate "${candidate}" -- ` +
        "add it to STATUS_DEFINITIONS (and the registry's own Status legend) if this is a real new status.",
    );
  }
  const remainder = cell
    .slice(definition.match.length)
    .replace(/^[\s,—/(-]+/, "")
    .replace(/\)\s*$/, "")
    .trim();
  return { statusId: definition.id, statusLabel: definition.label, statusQualifier: remainder || null };
}

function splitTableRow(line: string): readonly string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

const TABLE_SEPARATOR_PATTERN = /^\|?[\s:-]+\|[\s:|-]+$/;

/** Parses the registry's Markdown into topic sections, skipping any `##` section with no table (e.g. the legend itself). */
export function parseResearchRegistry(markdown: string): readonly RegistrySection[] {
  const lines = markdown.split("\n");
  const sections: RegistrySection[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.startsWith("## ")) {
      index += 1;
      continue;
    }

    const title = line.slice(3).trim();
    index += 1;
    let sourceDoc: string | null = null;

    // Scan forward for an optional "Full reasoning:" line (which may soft-wrap
    // onto following non-blank lines) and the table header.
    while (index < lines.length && !lines[index].startsWith("## ")) {
      const current = lines[index];
      if (current.startsWith(FULL_REASONING_PREFIX)) {
        const wrapped = [current];
        while (lines[index + 1]?.trim() && !lines[index + 1].trim().startsWith("|")) {
          index += 1;
          wrapped.push(lines[index]);
        }
        sourceDoc = parseSourceDoc(wrapped.join(" "));
      }
      if (current.trim().startsWith("|") && TABLE_SEPARATOR_PATTERN.test(lines[index + 1]?.trim() ?? "")) {
        index += 2; // skip the header row and the separator row
        break;
      }
      index += 1;
    }

    const rows: RegistryRow[] = [];
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      const cells = splitTableRow(lines[index]);
      if (cells.length >= 4) {
        const candidate = stripInlineMarkdown(cells[0]);
        rows.push({
          candidate,
          license: stripInlineMarkdown(cells[1]),
          ...parseStatusCell(cells[2], candidate),
          note: stripInlineMarkdown(cells[3]),
        });
      }
      index += 1;
    }

    if (rows.length > 0) {
      sections.push({ title, sourceDoc, rows });
    }
  }

  return sections;
}
