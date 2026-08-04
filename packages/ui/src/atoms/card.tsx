import { Card as AntCard } from "antd";
import type { ReactElement, ReactNode, CSSProperties } from "react";

import type { CardShape } from "../shared-types.js";

/** Public inputs for the smallest reusable bounded surface: a generic card. */
export interface CardProps {
  /**
   * Geometric outline of the card; defaults to a rounded rectangle.
   * @default "rectangle"
   */
  readonly shape?: CardShape;
  /**
   * Caller-owned content rendered inside the card.
   * @example "Body"
   */
  readonly children: ReactNode;
  /**
   * Optional accessible name for the card.
   * @example "Task status"
   */
  readonly ariaLabel?: string;
  /** Optional accent used for the card boundary. */
  readonly accentColor?: string;
  /**
   * Optional background color for the card surface.
   * @default "#ffffff"
   */
  readonly backgroundColor?: string;
  /**
   * Whether the card occupies the complete width and height of its container.
   * @default false
   */
  readonly fillContainer?: boolean;
  /**
   * Whether the card should communicate pointer interaction.
   * @default false
   */
  readonly interactive?: boolean;
  /**
   * Whether the card displays its selected treatment.
   * @default false
   */
  readonly selected?: boolean;
  /** Optional boundary color used when the card is selected. */
  readonly selectedColor?: string;
  /**
   * Optional boundary width in CSS pixels.
   * @default 1
   */
  readonly borderWidth?: number;
  /**
   * Optional rounded-corner radius in CSS pixels.
   * @default 8
   */
  readonly borderRadius?: number;
  /**
   * Optional padding in CSS pixels.
   * @default 12
   */
  readonly padding?: number;
  /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
  readonly glowColor?: string;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/**
 * Dependency-free bounded surface with replaceable accent and selection styles.
 *
 * @layer atom
 * @status stable
 */
export function Card(props: CardProps): ReactElement {
  const shape = props.shape ?? "rectangle";
  const usesAccentBoundary = props.accentColor !== undefined;
  const boundaryColor =
    props.selected === true && props.selectedColor !== undefined
      ? props.selectedColor
      : props.accentColor;

  const borderRadius =
    shape === "circle" ? "50%" : shape === "pill" ? 999 : (props.borderRadius ?? 8);

  const cardStyle: CSSProperties = {
    background: props.backgroundColor ?? "#ffffff",
    border: `${props.borderWidth ?? 1}px solid ${
      usesAccentBoundary ? boundaryColor : "rgba(0, 0, 0, 0.08)"
    }`,
    borderRadius,
    boxShadow: props.glowColor === undefined ? undefined : `0 0 16px 4px ${props.glowColor}`,
    boxSizing: "border-box",
    cursor: props.interactive ? "pointer" : undefined,
    height: props.fillContainer ? "100%" : undefined,
    minWidth: 0,
    overflow: "hidden",
    width: "100%",
  };

  const bodyStyle: CSSProperties = {
    boxSizing: "border-box",
    height: props.fillContainer ? "100%" : undefined,
    padding: props.padding ?? 12,
  };

  return (
    <AntCard
      aria-label={props.ariaLabel}
      className={props.className}
      data-selected={props.selected === undefined ? undefined : String(props.selected)}
      data-shape={shape}
      variant="borderless"
      style={cardStyle}
      styles={{ body: bodyStyle }}
    >
      {props.children}
    </AntCard>
  );
}