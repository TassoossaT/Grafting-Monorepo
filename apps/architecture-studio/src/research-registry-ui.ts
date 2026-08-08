// Presentation-layer helpers shared by /lab (the testing laboratory: live
// trials plus what's actively in development/review) and /registry (the
// full reference catalog of every candidate ever evaluated). Kept separate
// from research-registry.ts, which stays a plain Markdown parser with no
// UI-framework or @grafting/ui dependency.
import type { UiStatus } from "@grafting/ui";
import type { RegistryRow, RegistrySection, StatusId } from "./research-registry.ts";

/**
 * Candidate name -> a live, interactive trial of it under /lab.
 * Deliberately a small hard-coded map, not something inferred from the
 * registry itself -- only one candidate has a real trial today.
 */
export const DEMO_LINKS: Readonly<Record<string, string>> = {
  "noise-rs": "/lab/heightmap",
  "terrain-quantization": "/lab/terrain-quantization",
  "irregular-quad-grid": "/lab/irregular-grid",
  "stacked-terrain": "/lab/stacked-terrain",
};

export const SEMANTIC_STATUS: Readonly<Record<StatusId, UiStatus>> = {
  adopted: "success",
  decided: "success",
  "in-development": "warning",
  "in-review": "info",
  standby: "neutral",
  discarded: "error",
  "reference-only": "neutral",
};

export function statusLabelFor(row: RegistryRow): string {
  return row.statusQualifier ? `${row.statusLabel} — ${row.statusQualifier}` : row.statusLabel;
}

export interface LocatedRow {
  readonly row: RegistryRow;
  readonly sectionTitle: string;
}

/** Finds a candidate's row (and which topic section it lives in) across every section. */
export function findRowByCandidate(sections: readonly RegistrySection[], candidate: string): LocatedRow | undefined {
  for (const section of sections) {
    const row = section.rows.find((candidateRow) => candidateRow.candidate === candidate);
    if (row) return { row, sectionTitle: section.title };
  }
  return undefined;
}

/** Every row across every section whose status is "in-development" or "in-review". */
export function inProgressRows(sections: readonly RegistrySection[]): readonly LocatedRow[] {
  const result: LocatedRow[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.statusId === "in-development" || row.statusId === "in-review") {
        result.push({ row, sectionTitle: section.title });
      }
    }
  }
  return result;
}
