import { Descriptions as AntDescriptions } from "antd";
import type { ReactElement, ReactNode } from "react";

/** One label-value row. */
export interface DescriptionItem {
  /** Stable identity within the list. */
  readonly key: string;
  /**
   * Row label.
   * @example "Node ID"
   */
  readonly label: string;
  /** Row value, plain text or caller-rendered content. */
  readonly value: ReactNode;
}

/** Public inputs for a compact label-value grid. */
export interface DescriptionsProps {
  /** The rows to display, in order. */
  readonly items: readonly DescriptionItem[];
  /**
   * How many label-value pairs sit per row.
   * @default 1
   */
  readonly column?: number;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/**
 * A read-only label-value grid -- the right shape for an inspector or a
 * metrics panel, where {@link Card} (a bounded, bordered surface meant to
 * stand alone, e.g. in a gallery grid) adds a frame this content does not
 * need, especially when several of these already sit inside another bounded
 * surface like {@link Drawer} or a {@link Collapse} panel.
 *
 * @layer atom
 * @status stable
 */
export function Descriptions(props: DescriptionsProps): ReactElement {
  return (
    <AntDescriptions
      className={props.className}
      column={props.column ?? 1}
      size="small"
      items={props.items.map((item) => ({ key: item.key, label: item.label, children: item.value }))}
    />
  );
}
