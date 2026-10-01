"use client";

export interface RulerReadoutProps {
  /** What the ruler says, one line each -- already written in the table's unit. */
  readonly labels: readonly string[];
  /** Where the pointer is, in viewport pixels. */
  readonly x: number;
  readonly y: number;
}

/** How far from the pointer the readout stands, so it never sits under the cursor. */
const OFFSET = 16;

/** The ruler's distances, written next to the pointer while something is being built. */
export function RulerReadout(props: RulerReadoutProps) {
  return (
    <div
      aria-live="off"
      style={{
        position: "fixed",
        left: props.x + OFFSET,
        top: props.y + OFFSET,
        pointerEvents: "none",
        zIndex: 20,
        display: "grid",
        gap: "0.1rem",
        padding: "0.2rem 0.45rem",
        borderRadius: "0.35rem",
        background: "rgba(24, 34, 52, 0.92)",
        border: "1px solid #1e293b",
        color: "#7dd3fc",
        fontSize: "0.72rem",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {props.labels.map((label, index) => <span key={`${index}:${label}`}>{label}</span>)}
    </div>
  );
}
