import { FloatButton as AntFloatButton } from "antd";
import type { CSSProperties, ReactElement, ReactNode } from "react";

/** Public inputs for a single floating action, independent of any group. */
export interface FloatButtonProps {
  /**
   * Caller-rendered icon content. Vendor-neutral -- this atom never ships its own icon set.
   * @example "⚙"
   */
  readonly icon: ReactNode;
  /**
   * Tooltip and accessible name -- a float button shows no visible text label of its own.
   * @example "Configurações"
   */
  readonly tooltip: string;
  /** Invoked when this button is activated. */
  readonly onClick?: () => void;
  /** Renders this button non-interactive. */
  readonly disabled?: boolean;
  /**
   * Emphasis. `"primary"` is the right choice for a button that opens a
   * panel rather than firing a direct action, so it reads as distinct from
   * a same-row action cluster.
   * @default "default"
   */
  readonly tone?: "default" | "primary";
  /**
   * Outline. `"square"` reads as part of a joined block -- pair it with a
   * `FloatButtonGroup` molecule using the same shape so the two visually
   * belong together.
   * @default "circle"
   */
  readonly shape?: "circle" | "square";
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
  /** Optional caller-owned inline style, e.g. to place this button at a specific fixed position. */
  readonly style?: CSSProperties;
}

/**
 * One floating action, standalone -- the right shape for a corner-fixed
 * trigger like a settings-panel toggle, or a `Popover`/`Drawer` anchor whose
 * behavior (opens a panel) does not belong inside a `FloatButtonGroup`
 * molecule's list of direct actions.
 *
 * @layer atom
 * @status stable
 */
export function FloatButton(props: FloatButtonProps): ReactElement {
  return (
    <AntFloatButton
      className={props.className}
      style={props.style}
      icon={props.icon}
      tooltip={props.tooltip}
      onClick={props.onClick}
      disabled={props.disabled}
      type={props.tone ?? "default"}
      shape={props.shape ?? "circle"}
    />
  );
}
