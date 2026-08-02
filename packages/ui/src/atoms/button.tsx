import { Button as AntButton } from "antd";
import type { ReactElement } from "react";

/** Public inputs for a compact, clickable action. */
export interface ButtonProps {
  /**
   * Human-readable button label.
   * @example "Run"
   */
  readonly label: string;
  /** Invoked when the button is activated. */
  readonly onClick?: () => void;
  /**
   * Optional semantic emphasis.
   * @default "default"
   */
  readonly tone?: "default" | "accent";
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/**
 * Compact action button for lightweight command triggers.
 *
 * @layer atom
 * @status stable
 */
export function Button(props: ButtonProps): ReactElement {
  return (
    <AntButton
      className={props.className}
      onClick={props.onClick}
      size="small"
      type={props.tone === "accent" ? "primary" : "default"}
    >
      {props.label}
    </AntButton>
  );
}
