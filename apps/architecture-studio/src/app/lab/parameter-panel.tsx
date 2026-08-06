"use client";

import { Text } from "@grafting/ui";
import type { ReactElement } from "react";
import type { BenchParamSpec, BenchParamValue, BenchParamValues } from "../../bench/node-kind.ts";

const CONTROL_STYLE = { width: "100%", boxSizing: "border-box" as const, padding: "2px 6px" };

/** Inputs for the generated parameter surface of one selected node. */
export interface ParameterPanelProps {
  /** Parameter declarations of the selected node's element. */
  readonly specs: readonly BenchParamSpec[];
  /** The selected node's current values. */
  readonly values: BenchParamValues;
  /** Receives an edited value; coercion happens in the graph layer. */
  readonly onChange: (paramId: string, raw: BenchParamValue) => void;
}

function control(
  spec: BenchParamSpec,
  value: BenchParamValue | undefined,
  onChange: (paramId: string, raw: BenchParamValue) => void,
): ReactElement {
  const id = `param-${spec.id}`;
  switch (spec.kind) {
    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(spec.id, event.target.checked)}
        />
      );
    case "enum":
      return (
        <select
          id={id}
          value={String(value ?? spec.defaultValue)}
          onChange={(event) => onChange(spec.id, event.target.value)}
          style={CONTROL_STYLE}
        >
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case "number":
      return (
        <input
          id={id}
          type="number"
          value={Number(value ?? spec.defaultValue)}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? "any"}
          onChange={(event) => onChange(spec.id, event.target.value)}
          style={CONTROL_STYLE}
        />
      );
    default:
      // `integer` and `seed` share a control; they differ in how the graph
      // layer coerces the value, not in how it is typed.
      return (
        <input
          id={id}
          type="number"
          value={Number(value ?? spec.defaultValue)}
          min={spec.kind === "integer" ? spec.min : undefined}
          max={spec.kind === "integer" ? spec.max : undefined}
          step={1}
          onChange={(event) => onChange(spec.id, event.target.value)}
          style={CONTROL_STYLE}
        />
      );
  }
}

/**
 * Renders one control per declared parameter.
 *
 * The panel reads only the specs, never a per-element layout, which is what
 * lets a new laboratory element arrive without touching bench UI (ADR-0019).
 */
export default function ParameterPanel({ specs, values, onChange }: ParameterPanelProps): ReactElement {
  if (specs.length === 0) return <Text content="This element has no parameters." tone="muted" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {specs.map((spec) => (
        <div key={spec.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <label htmlFor={`param-${spec.id}`} style={{ fontSize: 12, fontWeight: 600 }}>
            {spec.label}
          </label>
          {control(spec, values[spec.id], onChange)}
          {spec.description === undefined ? null : (
            <Text content={spec.description} tone="muted" />
          )}
        </div>
      ))}
    </div>
  );
}
