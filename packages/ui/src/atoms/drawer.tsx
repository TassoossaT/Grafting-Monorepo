import { Drawer as AntDrawer } from "antd";
import type { ReactElement, ReactNode } from "react";

/** Public inputs for a panel that slides in from a screen edge. */
export interface DrawerProps {
  /** Whether the drawer is currently shown. */
  readonly open: boolean;
  /** Invoked when the drawer requests to close, e.g. its own close button or Escape. */
  readonly onClose: () => void;
  /** Optional header text shown above the content. */
  readonly title?: string;
  /** Content rendered inside the drawer body. */
  readonly children: ReactNode;
  /**
   * Which screen edge the drawer slides in from.
   * @default "right"
   */
  readonly placement?: "left" | "right" | "top" | "bottom";
  /**
   * Drawer width (for `left`/`right` placement) or height (for `top`/`bottom`), in CSS pixels.
   * @default 320
   */
  readonly size?: number;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/**
 * An edge-sliding settings/inspector panel, built on Ant Design's own
 * `Drawer`. Non-modal by default (no backdrop, no interaction lock on the
 * rest of the page) -- the common case for a persistent settings panel
 * beside a live 3D viewport, where blocking the scene behind it would be
 * unwanted.
 *
 * @layer atom
 * @status stable
 */
export function Drawer(props: DrawerProps): ReactElement {
  return (
    <AntDrawer
      className={props.className}
      mask={false}
      onClose={props.onClose}
      open={props.open}
      placement={props.placement ?? "right"}
      size={props.size ?? 320}
      title={props.title}
    >
      {props.children}
    </AntDrawer>
  );
}
