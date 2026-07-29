import { Card, Flex } from "antd";

import { StatusBadgeView } from "../atoms/status-badge.js";
import { TextView } from "../atoms/text.js";
import type { EntitySummaryProps } from "../index.js";

export function EntitySummaryView(props: EntitySummaryProps) {
  const hasStatus = props.status !== undefined && props.statusLabel !== undefined;
  const usesAccentBoundary = props.accentColor !== undefined;

  return (
    <Card
      aria-label={props.ariaLabel}
      className={props.className}
      data-selected={props.selected === undefined ? undefined : String(props.selected)}
      size="small"
      styles={{
        body: {
          boxSizing: "border-box",
          height: props.fillContainer ? "100%" : undefined,
          minWidth: 0,
          padding: props.bodyPadding ?? 12,
        },
      }}
      style={{
        background: props.backgroundColor,
        border: usesAccentBoundary
          ? `${props.borderWidth ?? 1}px solid ${
              props.selected && props.selectedColor !== undefined
                ? props.selectedColor
                : props.accentColor
            }`
          : undefined,
        borderRadius: props.borderRadius,
        boxSizing: "border-box",
        cursor: props.interactive ? "pointer" : undefined,
        height: props.fillContainer ? "100%" : undefined,
        minWidth: 0,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <Flex align="center" gap={props.contentGap ?? 10} style={{ minWidth: 0 }}>
        {props.leading}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <TextView content={props.title} strong truncate />
          {props.description === undefined ? null : (
            <TextView content={props.description} tone="muted" truncate />
          )}
        </div>
        {hasStatus ? (
          <StatusBadgeView label={props.statusLabel} status={props.status} />
        ) : null}
        {props.actions}
      </Flex>
    </Card>
  );
}
