import { Flex } from "antd";

import { ButtonView } from "../atoms/button.js";
import { CardView } from "../atoms/card.js";
import { StatusBadgeView } from "../atoms/status-badge.js";
import { TextView } from "../atoms/text.js";
import type { EntitySummaryProps } from "../index.js";

/** The card keeps a fixed, compact height; only the first few tags are shown. */
const MAX_VISIBLE_TAGS = 3;

export function EntitySummaryView(props: EntitySummaryProps) {
  const hasStatus = props.status !== undefined && props.statusLabel !== undefined;
  const tags = props.tags?.slice(0, MAX_VISIBLE_TAGS) ?? [];

  return (
    <CardView
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
          <TextView content={props.title} strong truncate />
          {props.description === undefined ? null : (
            <TextView content={props.description} tone="muted" truncate />
          )}
        </div>
        {hasStatus ? (
          <StatusBadgeView label={props.statusLabel} status={props.status} />
        ) : null}
        {props.actionLabel === undefined ? null : (
          <ButtonView label={props.actionLabel} onClick={props.onAction} tone="accent" />
        )}
        {props.actions}
      </Flex>
      {tags.length === 0 ? null : (
        <Flex gap={4} style={{ flexWrap: "wrap", marginTop: 6, minWidth: 0 }}>
          {tags.map((tag) => (
            <StatusBadgeView key={tag} label={tag} status="neutral" />
          ))}
        </Flex>
      )}
    </CardView>
  );
}
