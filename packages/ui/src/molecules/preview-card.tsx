import { Flex } from "antd";
import type { ReactElement, ReactNode } from "react";

import { Card } from "../atoms/card.js";
import { StatusBadge } from "../atoms/status-badge.js";
import { Text } from "../atoms/text.js";
import type { UiStatus } from "../shared-types.js";

/** Public inputs for a gallery-style tile: cover image, title/description, status, tags, and actions. */
export interface PreviewCardProps {
  /**
   * Primary human-readable title.
   * @example "Heightmap generation"
   */
  readonly title: string;
  /**
   * Optional secondary description.
   * @example "Perlin-noise procedural terrain heightmap, computed in Rust via Wasm."
   */
  readonly description?: string;
  /**
   * Optional cover image shown above the title, clipped to the card's own
   * corners. `alt` is bundled with `src` so accessible text can never be
   * forgotten when a cover is present.
   * @example
   * ```tsx
   * { src: "/preview.png", alt: "Rendered heightmap preview" }
   * ```
   */
  readonly cover?: { readonly src: string; readonly alt: string };
  /**
   * Optional semantic status.
   * @example "success"
   */
  readonly status?: UiStatus;
  /**
   * Human-readable label paired with status.
   * @example "Adopted"
   */
  readonly statusLabel?: string;
  /**
   * Optional short caller-owned labels rendered as compact badges.
   * @default []
   * @example ["MIT", "top pick"]
   */
  readonly tags?: readonly string[];
  /** Optional actions rendered at the bottom of the card. */
  readonly actions?: ReactNode;
  /** Optional accessible name for the card container. */
  readonly ariaLabel?: string;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
  /** Optional glow color rendered as an outer shadow, e.g. to signal live status. */
  readonly glowColor?: string;
  /**
   * Whether the card should communicate pointer interaction.
   * @default false
   */
  readonly interactive?: boolean;
  /**
   * Whether the card displays its selected treatment.
   * @default false
   */
  readonly selected?: boolean;
  /** Optional boundary color used when the card is selected. */
  readonly selectedColor?: string;
  /** Optional accent used for the card boundary. */
  readonly accentColor?: string;
  /**
   * Optional background color for the card surface.
   * @default "#ffffff"
   */
  readonly backgroundColor?: string;
  /**
   * Whether the card occupies the complete width and height of its container.
   * @default false
   */
  readonly fillContainer?: boolean;
}

const BODY_PADDING = 12;

/**
 * Gallery-style tile built from Card, Text, and StatusBadge: a cover image,
 * title/description, status, tags, and caller-owned actions.
 *
 * @layer molecule
 * @status stable
 */
export function PreviewCard(props: PreviewCardProps): ReactElement {
  const hasStatus = props.status !== undefined && props.statusLabel !== undefined;
  const tags = props.tags ?? [];

  return (
    <Card
      accentColor={props.accentColor}
      ariaLabel={props.ariaLabel}
      backgroundColor={props.backgroundColor}
      className={props.className}
      fillContainer={props.fillContainer}
      glowColor={props.glowColor}
      interactive={props.interactive}
      padding={0}
      selected={props.selected}
      selectedColor={props.selectedColor}
    >
      <Text content={props.title} strong />
      {props.cover === undefined ? null : (
        <img
          alt={props.cover.alt}
          src={props.cover.src}
          style={{ aspectRatio: "16 / 9", display: "block", objectFit: "cover", width: "100%" }}
        />
      )}
      <div style={{ padding: BODY_PADDING }}>
        {props.description === undefined ? null : <Text content={props.description} tone="muted" />}
        {!hasStatus && tags.length === 0 ? null : (
          <Flex gap={4} style={{ flexWrap: "wrap", marginTop: 6, minWidth: 0 }}>
            {hasStatus ? <StatusBadge label={props.statusLabel} status={props.status} /> : null}
            {tags.map((tag) => (
              <StatusBadge key={tag} label={tag} status="neutral" />
            ))}
          </Flex>
        )}
        {props.actions === undefined ? null : <div style={{ marginTop: 8 }}>{props.actions}</div>}
      </div>
    </Card>
  );
}
