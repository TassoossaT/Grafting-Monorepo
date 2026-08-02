import { Flex } from "antd";
import type { ReactElement, ReactNode } from "react";

import { Button } from "../atoms/button.js";
import { Card } from "../atoms/card.js";
import { StatusBadge } from "../atoms/status-badge.js";
import { Text } from "../atoms/text.js";
import { mountReactView } from "../hosts/mount-react-view.js";
import type { CardShape, UiMountHandle, UiStatus } from "../shared-types.js";

/** Public inputs for a reusable entity summary shown in canvases, tables, or inspectors. */
export interface EntitySummaryProps {
  /** Primary human-readable entity name. */
  readonly title: string;
  /** Optional secondary description. */
  readonly description?: string;
  /** Optional semantic status. */
  readonly status?: UiStatus;
  /** Human-readable label paired with status. */
  readonly statusLabel?: string;
  /** Optional visual placed before the textual identity. */
  readonly leading?: ReactNode;
  /** Optional actions placed after the textual identity. */
  readonly actions?: ReactNode;
  /** Optional accessible name for the summary container. */
  readonly ariaLabel?: string;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
  /** Optional accent used for the complete card boundary. */
  readonly accentColor?: string;
  /** Optional background color for the complete card surface. */
  readonly backgroundColor?: string;
  /** Whether the card occupies the complete width and height of its container. */
  readonly fillContainer?: boolean;
  /** Whether the card should communicate pointer interaction. */
  readonly interactive?: boolean;
  /** Whether the card displays its selected treatment. */
  readonly selected?: boolean;
  /** Optional boundary color used when the component is selected. */
  readonly selectedColor?: string;
  /** Optional boundary width in CSS pixels. */
  readonly borderWidth?: number;
  /** Optional rounded-corner radius in CSS pixels. */
  readonly borderRadius?: number;
  /** Optional body padding in CSS pixels. */
  readonly bodyPadding?: number;
  /** Optional gap between the component's content regions. */
  readonly contentGap?: number;
  /** Optional short caller-owned labels rendered as compact badges below the identity. */
  readonly tags?: readonly string[];
  /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
  readonly glowColor?: string;
  /** Geometric outline of the card; defaults to a rounded rectangle. */
  readonly shape?: CardShape;
  /** Optional label for a compact action button rendered in the card. */
  readonly actionLabel?: string;
  /** Invoked when the action button is activated. */
  readonly onAction?: () => void;
}

/** The card keeps a fixed, compact height; only the first few tags are shown. */
const MAX_VISIBLE_TAGS = 3;

/**
 * Composable identity card built from Card, Text, and StatusBadge.
 *
 * @layer molecule
 * @status stable
 * @example Entity card
 * ```tsx
 * <EntitySummary title="architecture-studio" description="project" />
 * ```
 */
export function EntitySummary(props: EntitySummaryProps): ReactElement {
  const hasStatus = props.status !== undefined && props.statusLabel !== undefined;
  const tags = props.tags?.slice(0, MAX_VISIBLE_TAGS) ?? [];

  return (
    <Card
      accentColor={props.accentColor}
      ariaLabel={props.ariaLabel}
      backgroundColor={props.backgroundColor}
      borderRadius={props.borderRadius}
      borderWidth={props.borderWidth}
      className={props.className}
      fillContainer={props.fillContainer}
      glowColor={props.glowColor}
      interactive={props.interactive}
      shape={props.shape}
      padding={props.bodyPadding}
      selected={props.selected}
      selectedColor={props.selectedColor}
    >
      <Flex align="center" gap={props.contentGap ?? 10} style={{ minWidth: 0 }}>
        {props.leading}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <Text content={props.title} strong truncate />
          {props.description === undefined ? null : (
            <Text content={props.description} tone="muted" truncate />
          )}
        </div>
        {hasStatus ? (
          <StatusBadge label={props.statusLabel} status={props.status} />
        ) : null}
        {props.actionLabel === undefined ? null : (
          <Button label={props.actionLabel} onClick={props.onAction} tone="accent" />
        )}
        {props.actions}
      </Flex>
      {tags.length === 0 ? null : (
        <Flex gap={4} style={{ flexWrap: "wrap", marginTop: 6, minWidth: 0 }}>
          {tags.map((tag) => (
            <StatusBadge key={tag} label={tag} status="neutral" />
          ))}
        </Flex>
      )}
    </Card>
  );
}

/** Mounts an EntitySummary into an existing DOM host without exposing ReactDOM. */
export function mountEntitySummary(
  host: HTMLElement,
  props: EntitySummaryProps,
): UiMountHandle<EntitySummaryProps> {
  return mountReactView(host, props, (next) => EntitySummary(next));
}
