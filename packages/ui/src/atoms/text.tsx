import { Typography } from "antd";
import type { ReactElement } from "react";

/** Semantic text tones independent of the current visual implementation. */
export type TextTone = "default" | "muted" | "accent" | "danger";

/** Public inputs for the smallest reusable text presentation primitive. */
export interface TextProps {
  /**
   * Text content rendered by the component.
   * @example "Example label"
   */
  readonly content: string;
  /**
   * Optional semantic color treatment.
   * @default "default"
   */
  readonly tone?: TextTone;
  /**
   * Whether the text uses the emphasized weight.
   * @default false
   */
  readonly strong?: boolean;
  /**
   * Whether overflowing single-line content is truncated with an accessible tooltip.
   * @default false
   */
  readonly truncate?: boolean;
  /** Optional tooltip text used when truncation is enabled. */
  readonly tooltip?: string;
  /**
   * Optional maximum width in CSS pixels.
   * @default "100%"
   */
  readonly maxWidth?: number;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

const toneColors: Readonly<Record<TextTone, string | undefined>> = {
  default: undefined,
  muted: "rgba(0, 0, 0, 0.58)",
  accent: "#1677ff",
  danger: "#ff4d4f",
};

/**
 * Bounded text with semantic tone and optional truncation.
 *
 * @layer atom
 * @status stable
 */
export function Text(props: TextProps): ReactElement {
  const maxWidth = props.maxWidth === undefined ? "100%" : props.maxWidth;

  return (
    <Typography.Text
      className={props.className}
      ellipsis={props.truncate ? { tooltip: props.tooltip ?? props.content } : false}
      strong={props.strong}
      style={{
        color: toneColors[props.tone ?? "default"],
        display: "block",
        maxWidth,
        minWidth: 0,
      }}
    >
      {props.content}
    </Typography.Text>
  );
}
