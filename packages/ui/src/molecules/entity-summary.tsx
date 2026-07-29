import { Card, Flex } from "antd";

import { StatusBadgeView } from "../atoms/status-badge.js";
import { TextView } from "../atoms/text.js";
import type { EntitySummaryProps } from "../index.js";

export function EntitySummaryView(props: EntitySummaryProps) {
  const hasStatus = props.status !== undefined && props.statusLabel !== undefined;

  return (
    <Card
      aria-label={props.ariaLabel}
      className={props.className}
      size="small"
      styles={{ body: { minWidth: 0, padding: 12 } }}
      style={{ minWidth: 0, overflow: "hidden", width: "100%" }}
    >
      <Flex align="center" gap={10} style={{ minWidth: 0 }}>
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
