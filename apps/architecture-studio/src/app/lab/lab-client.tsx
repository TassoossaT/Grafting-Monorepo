"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, GridLayout, PreviewCard, StatusBadge, Text, type GridPanel } from "@grafting/ui";
import "react-grid-layout/css/styles.css";
import { readPreviewImage } from "../../lab-preview-storage.ts";
import type { RegistrySection } from "../../research-registry.ts";
import { DEMO_LINKS, SEMANTIC_STATUS, findRowByCandidate, inProgressRows, statusLabelFor } from "../../research-registry-ui.ts";

const TRIAL_TILE_WIDTH = 4;
const TRIAL_TILE_HEIGHT = 9;
const TRIAL_COLUMNS = 12;

/** The actual testing laboratory: live trials you can go run, plus what's actively in development or review. Full history lives in /registry. */
export default function LabClient({ sections }: { sections: readonly RegistrySection[] }) {
  const trials = Object.entries(DEMO_LINKS).map(([candidate, href]) => ({
    href,
    candidate,
    located: findRowByCandidate(sections, candidate),
  }));
  const queue = inProgressRows(sections);

  // localStorage is client-only and trial pages write to it after this page has
  // already rendered, so previews load post-mount rather than as initial state.
  const [previewImages, setPreviewImages] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const trial of trials) {
      const image = readPreviewImage(trial.candidate);
      if (image !== undefined) next[trial.candidate] = image;
    }
    setPreviewImages(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `trials` is rebuilt every render from a stable DEMO_LINKS map; keying off it would loop.
  }, []);

  const trialPanels: readonly GridPanel[] = trials.map((trial, index) => ({
    placement: {
      id: trial.candidate,
      x: (index % (TRIAL_COLUMNS / TRIAL_TILE_WIDTH)) * TRIAL_TILE_WIDTH,
      y: Math.floor(index / (TRIAL_COLUMNS / TRIAL_TILE_WIDTH)) * TRIAL_TILE_HEIGHT,
      width: TRIAL_TILE_WIDTH,
      height: TRIAL_TILE_HEIGHT,
    },
    content: (
      <Link href={trial.href} style={{ display: "block", height: "100%", textDecoration: "none", color: "inherit" }}>
        <PreviewCard
          ariaLabel={trial.candidate}
          title={trial.candidate}
          description={trial.located?.row.note}
          cover={
            previewImages[trial.candidate] === undefined
              ? undefined
              : { src: previewImages[trial.candidate], alt: `Captured preview for ${trial.candidate}` }
          }
          status={trial.located !== undefined ? SEMANTIC_STATUS[trial.located.row.statusId] : undefined}
          statusLabel={trial.located !== undefined ? statusLabelFor(trial.located.row) : undefined}
          interactive
          fillContainer
          actions={<Text content="Open trial →" tone="accent" />}
        />
      </Link>
    ),
  }));

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
        <div style={{ marginTop: 8 }}>
          <GridLayout panels={trialPanels} ariaLabel="Active lab trials" rowHeight={32} draggable resizable />
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
