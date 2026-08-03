"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, DataTable, StatusBadge, Text } from "@grafting/ui";
import { STATUS_DEFINITIONS, type RegistryRow, type RegistrySection, type StatusId } from "../../research-registry.ts";
import { DEMO_LINKS, SEMANTIC_STATUS, statusLabelFor } from "../../research-registry-ui.ts";

interface CatalogRow extends RegistryRow {
  readonly key: string;
}

function CandidateCell({ row }: { row: CatalogRow }) {
  const demoHref = DEMO_LINKS[row.candidate];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Text content={row.candidate} strong />
      {demoHref !== undefined && (
        <Link href={demoHref} style={{ fontSize: 12 }}>
          Open in Lab &rarr;
        </Link>
      )}
    </div>
  );
}

/** Full reference catalog: every candidate this repository has ever evaluated. See /lab for what's actually being tried right now. */
export default function RegistryClient({ sections }: { sections: readonly RegistrySection[] }) {
  const [activeStatuses, setActiveStatuses] = useState<ReadonlySet<StatusId>>(
    () => new Set(STATUS_DEFINITIONS.map((definition) => definition.id)),
  );

  const toggleStatus = (id: StatusId) => {
    setActiveStatuses((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          rows: section.rows
            .filter((row) => activeStatuses.has(row.statusId))
            .map((row): CatalogRow => ({ ...row, key: `${section.title}::${row.candidate}` })),
        }))
        .filter((section) => section.rows.length > 0),
    [sections, activeStatuses],
  );

  const totalRows = sections.reduce((count, section) => count + section.rows.length, 0);
  const visibleRows = visibleSections.reduce((count, section) => count + section.rows.length, 0);

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Text content="Registry" strong />
        <Text
          content="Every tool/library candidate this repository has ever evaluated, one row each, sourced directly from docs/research/RESEARCH-DECISIONS-REGISTRY.md. This is reference/history, not a place to run anything -- for what's actually being tried right now, see Lab."
          tone="muted"
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {STATUS_DEFINITIONS.map((definition) => {
          const active = activeStatuses.has(definition.id);
          return (
            <button
              key={definition.id}
              type="button"
              onClick={() => toggleStatus(definition.id)}
              aria-pressed={active}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid rgba(0, 0, 0, 0.15)",
                background: active ? "#e6f4ff" : "#f5f5f5",
                color: active ? "#1677ff" : "rgba(0, 0, 0, 0.45)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {definition.label}
            </button>
          );
        })}
        <Text content={`${visibleRows} of ${totalRows} candidates shown`} tone="muted" />
      </div>

      {visibleSections.map((section) => (
        <Card key={section.title} ariaLabel={section.title}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <Text content={section.title} strong />
              {section.sourceDoc !== null && <Text content={section.sourceDoc} tone="muted" />}
            </div>
            <DataTable<CatalogRow>
              rows={section.rows}
              rowKey={(row) => row.key}
              ariaLabel={`${section.title} candidates`}
              pagination={false}
              density="compact"
              columns={[
                {
                  id: "candidate",
                  header: "Candidate",
                  value: (row) => row.candidate,
                  renderCell: ({ row }) => <CandidateCell row={row} />,
                },
                { id: "license", header: "License", value: (row) => row.license, width: 200 },
                {
                  id: "status",
                  header: "Status",
                  value: (row) => row.statusLabel,
                  width: 220,
                  renderCell: ({ row }) => (
                    <StatusBadge status={SEMANTIC_STATUS[row.statusId]} label={statusLabelFor(row)} />
                  ),
                },
                { id: "note", header: "Note", value: (row) => row.note },
              ]}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}
