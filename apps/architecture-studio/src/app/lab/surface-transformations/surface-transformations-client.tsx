"use client";

import { useState } from "react";
import { Button, Card, Text } from "@grafting/ui";

type Fixture = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly brush: { readonly cx: number; readonly cy: number; readonly r: number };
  readonly assertions: readonly string[];
  readonly invalidation: readonly string[];
};

const FIXTURES: readonly Fixture[] = [
  {
    id: "middle-crossing",
    title: "Middle crossing",
    description: "A circular brush crosses the centre of one terrain surface.",
    path: "M20 20 H280 V180 H20 Z",
    brush: { cx: 150, cy: 100, r: 48 },
    assertions: ["The painted cycle is separated from terrain outside the circle.", "New boundary nodes are required only where the circle cuts an edge.", "The fixture names path as the target type; it does not calculate an intersection."],
    invalidation: ["changed: terrain/large", "repair neighbours: none", "unrelated cloud: excluded"],
  },
  {
    id: "shared-boundary",
    title: "Shared external boundary",
    description: "Two terrain surfaces share the outer node hit by the brush boundary.",
    path: "M20 20 H150 V180 H20 Z M150 20 H280 V180 H150 Z",
    brush: { cx: 150, cy: 100, r: 55 },
    assertions: ["The shared external node remains preserved.", "Only interior/remodelled nodes may be replaced.", "Both intersected surfaces remain one semantic stroke."],
    invalidation: ["changed: terrain/left, terrain/right", "repair neighbours: shared boundary", "unrelated cloud: excluded"],
  },
  {
    id: "fragment-cleanup",
    title: "Brush-relative fragment cleanup",
    description: "A narrow sliver is authored as a deterministic plan outcome, not computed in the browser.",
    path: "M20 20 H280 V180 H20 Z M138 20 L150 20 L150 180 L138 180 Z",
    brush: { cx: 150, cy: 100, r: 64 },
    assertions: ["First: absorb into the intended painted region when the boundary stays valid.", "Second: otherwise merge with the same-type neighbour sharing the largest boundary.", "Final tie-break: stable identity ordering."],
    invalidation: ["changed: terrain/sliver", "repair neighbours: largest shared boundary", "unrelated cloud: excluded"],
  },
];

const COSTS = [
  ["1,024", "247.9 µs"],
  ["10,000", "278.2 µs"],
  ["99,856", "555.5 µs"],
] as const;

/** Visual, immutable proof fixtures for Phase A; Rust owns the future transformer. */
export default function SurfaceTransformationsClient() {
  const [selectedId, setSelectedId] = useState(FIXTURES[0].id);
  const fixture = FIXTURES.find((candidate) => candidate.id === selectedId) ?? FIXTURES[0];

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 980, margin: "16px auto" }}>
      <div>
        <Text content="VTT surface transformations — Phase A laboratory" strong />
        <Text content="Contract fixtures only: this page neither intersects brush geometry nor mutates topology. Those are Rust transformer work in Phase B." tone="muted" />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FIXTURES.map((candidate) => <Button key={candidate.id} label={candidate.title} onClick={() => setSelectedId(candidate.id)} />)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(260px, 1fr)", gap: 16 }}>
        <Card ariaLabel="Synthetic surface fixture">
          <div style={{ display: "grid", gap: 8 }}>
            <Text content={fixture.title} strong />
            <Text content={fixture.description} tone="muted" />
            <svg viewBox="0 0 300 200" role="img" aria-label={`${fixture.title} synthetic surface`} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 8, background: "#f8fafc" }}>
              <path d={fixture.path} fill="#a7d5a8" stroke="#365c3a" strokeWidth="3" fillRule="evenodd" />
              <circle cx={fixture.brush.cx} cy={fixture.brush.cy} r={fixture.brush.r} fill="#b7791f" fillOpacity="0.35" stroke="#92400e" strokeWidth="3" strokeDasharray="6 4" />
              <text x="16" y="194" fontSize="10" fill="#334155">synthetic terrain surfaces</text>
            </svg>
          </div>
        </Card>

        <Card ariaLabel="Contract assertions">
          <div style={{ display: "grid", gap: 10 }}>
            <Text content="Expected plan assertions" strong />
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {fixture.assertions.map((assertion) => <li key={assertion}>{assertion}</li>)}
            </ul>
            <Text content="Local invalidation envelope" strong />
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {fixture.invalidation.map((entry) => <li key={entry}>{entry}</li>)}
            </ul>
          </div>
        </Card>
      </div>

      <Card ariaLabel="Local invalidation measurement">
        <div style={{ display: "grid", gap: 8 }}>
          <Text content="Measured local invalidation baseline" strong />
          <Text content="Existing Rust surface invalidation + mesh derivation benchmark; 200 deterministic 7×7-node strokes, 1.67 ms ceiling." tone="muted" />
          <table><thead><tr><th align="left">Surfaces</th><th align="left">Per stroke</th></tr></thead><tbody>{COSTS.map(([count, cost]) => <tr key={count}><td>{count}</td><td>{cost}</td></tr>)}</tbody></table>
        </div>
      </Card>
    </div>
  );
}
