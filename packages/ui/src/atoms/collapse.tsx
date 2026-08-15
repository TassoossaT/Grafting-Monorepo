import { Collapse as AntCollapse } from "antd";
import type { ReactElement, ReactNode } from "react";

/** One collapsible section. */
export interface CollapsePanel {
  /** Stable identity within the list, and what `defaultActiveKeys` names. */
  readonly key: string;
  /**
   * Section header, always visible.
   * @example "Inspector de Seleção"
   */
  readonly header: string;
  /** Section content, shown when expanded. */
  readonly content: ReactNode;
}

/** Public inputs for a set of stacked, individually collapsible sections. */
export interface CollapseProps {
  /** The sections, in display order. */
  readonly panels: readonly CollapsePanel[];
  /** Which panel keys start expanded. Defaults to every panel's own key, i.e. all expanded. */
  readonly defaultActiveKeys?: readonly string[];
  /**
   * Whether the whole set draws its own outer border and panel background.
   * Set to `false` when this sits inside a surface that already provides
   * its own boundary (e.g. a {@link Drawer}) -- left `true`, both frame the
   * same content and it reads as boxed twice.
   * @default true
   */
  readonly bordered?: boolean;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

/**
 * Several named sections stacked in one surface, each independently
 * expandable -- the right shape for a settings/inspector panel with more
 * than one topic, where stacking a separate {@link Card} per topic would
 * double the framing (the panel this sits inside, e.g. a {@link Drawer},
 * already provides the outer boundary).
 *
 * @layer atom
 * @status stable
 */
export function Collapse(props: CollapseProps): ReactElement {
  const bordered = props.bordered ?? true;
  return (
    <AntCollapse
      className={props.className}
      defaultActiveKey={[...(props.defaultActiveKeys ?? props.panels.map((panel) => panel.key))]}
      items={props.panels.map((panel) => ({ key: panel.key, label: panel.header, children: panel.content }))}
      bordered={bordered}
      ghost={!bordered}
    />
  );
}
