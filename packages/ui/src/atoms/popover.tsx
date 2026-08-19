import { Popover as AntPopover } from "antd";
import type { ReactElement, ReactNode } from "react";

/** Public inputs for a small floating panel anchored to a trigger element. */
export interface PopoverProps {
  /**
   * The element the popover positions itself against.
   * @example <button>Open</button>
   */
  readonly anchor: ReactNode;
  /**
   * Whether the popover is currently shown.
   * @example true
   */
  readonly open: boolean;
  /**
   * Invoked when the popover requests to close, e.g. an outside click or Escape.
   * @example () => {}
   */
  readonly onClose: () => void;
  /** Optional header text shown above the content. */
  readonly title?: string;
  /**
   * Content rendered inside the popover body.
   * @example <div>Content</div>
   */
  readonly children: ReactNode;
  /**
   * Which side of `anchor` the popover opens toward.
   * @default "top"
   */
  readonly placement?: "top" | "bottom" | "left" | "right";
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/**
 * Dismissible floating content anchored to a trigger element -- e.g. a
 * shape/material picker opened from a toolbar button -- built on Ant
 * Design's own `Popover` rather than a hand-positioned overlay, since
 * anchor-relative placement (including flipping when it would overflow the
 * viewport) is exactly what that vendor primitive already solves.
 *
 * @layer atom
 * @status stable
 */
export function Popover(props: PopoverProps): ReactElement {
  return (
    <AntPopover
      className={props.className}
      content={props.children}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      open={props.open}
      placement={props.placement ?? "top"}
      title={props.title}
      trigger="click"
    >
      {props.anchor}
    </AntPopover>
  );
}
