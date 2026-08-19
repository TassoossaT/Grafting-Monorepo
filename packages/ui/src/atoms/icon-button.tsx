import { Button as AntButton } from "antd";
import type { ReactElement, ReactNode } from "react";

/** Public inputs for a compact, icon-first action or toggle. */
export interface IconButtonProps {
  /**
   * Caller-rendered icon content (glyph, emoji, or inline SVG). Vendor-neutral
   * on purpose -- this atom never ships its own icon set.
   * @example "▢"
   */
  readonly icon: ReactNode;
  /** Optional visible label rendered beside the icon. Icon-only when omitted. */
  readonly label?: string;
  /**
   * Accessible name and hover tooltip. Required when `label` is omitted, since an icon-only button has no other text content.
   * @example "Toggle sidebar"
   */
  readonly title: string;
  /** Invoked when the button is activated. */
  readonly onClick?: () => void;
  /**
   * Whether the button displays its selected/active treatment.
   * @default false
   */
  readonly selected?: boolean;
  /**
   * Whether the button rejects interaction.
   * @default false
   */
  readonly disabled?: boolean;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/**
 * Compact icon-first action button with an explicit selected state, for
 * toolbars, rails, and hotbars where a text-label {@link Button} would not
 * fit -- backed by the same Ant Design button as {@link Button}, with
 * Grafting owning the selected-state boundary color rather than trusting a
 * vendor theme default.
 *
 * @layer atom
 * @status stable
 */
export function IconButton(props: IconButtonProps): ReactElement {
  return (
    <AntButton
      className={props.className}
      data-selected={props.selected === undefined ? undefined : String(props.selected)}
      disabled={props.disabled}
      icon={props.icon}
      onClick={props.onClick}
      shape={props.label === undefined ? "circle" : undefined}
      size="small"
      style={{
        borderColor: props.selected === true ? "currentColor" : undefined,
      }}
      title={props.title}
      type={props.selected === true ? "primary" : "default"}
    >
      {props.label}
    </AntButton>
  );
}
