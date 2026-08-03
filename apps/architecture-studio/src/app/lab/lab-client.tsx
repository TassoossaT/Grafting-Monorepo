"use client";

import Link from "next/link";
import { Card, StatusBadge, Text } from "@grafting/ui";
import type { RegistrySection } from "../../research-registry.ts";
import { DEMO_LINKS, SEMANTIC_STATUS, findRowByCandidate, inProgressRows, statusLabelFor } from "../../research-registry-ui.ts";

/** The actual testing laboratory: live trials you can go run, plus what's actively in development or review. Full history lives in /registry. */
export default function LabClient({ sections }: { sections: readonly RegistrySection[] }) {
  const trials = Object.entries(DEMO_LINKS).map(([candidate, href]) => ({
    href,
    candidate,
    located: findRowByCandidate(sections, candidate),
  }));
  const queue = inProgressRows(sections);

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Text content="Lab" strong />
        <Text
          content="Where you go to actually run and try things, not just read about them. Full evaluation history lives in Registry."
          tone="muted"
        />
      </div>

      <section>
        <Text content="Active trials" strong />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
          {trials.map((trial) => (
            <div key={trial.href} style={{ width: 320 }}>
              <Card ariaLabel={trial.candidate} interactive>
                <Link href={trial.href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
                  <Text content={trial.candidate} strong />
                  {trial.located !== undefined && (
                    <>
                      <StatusBadge
                        status={SEMANTIC_STATUS[trial.located.row.statusId]}
                        label={statusLabelFor(trial.located.row)}
                      />
                      <Text content={trial.located.row.note} tone="muted" />
                    </>
                  )}
                  <Text content="Open trial →" tone="accent" />
                </Link>
              </Card>
            </div>
          ))}
        </div>
      </section>

      <section>
        <Text content="In development / in review" strong />
        {queue.length === 0 ? (
          <Text content="Nothing marked in development or in review right now." tone="muted" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {queue.map(({ row, sectionTitle }) => {
              const demoHref = DEMO_LINKS[row.candidate];
              return (
                <Card key={`${sectionTitle}::${row.candidate}`} ariaLabel={row.candidate}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text content={row.candidate} strong />
                    <StatusBadge status={SEMANTIC_STATUS[row.statusId]} label={statusLabelFor(row)} />
                    <Text content={sectionTitle} tone="muted" />
                    <Text content={row.note} tone="muted" />
                    {demoHref !== undefined && <Link href={demoHref}>Open trial &rarr;</Link>}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
