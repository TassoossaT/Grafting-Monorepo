import { Tag } from "antd";
import type { ReactElement } from "react";

/** Public inputs for a small, toggleable choice within a set of options. */
export interface SelectableChipProps {
  /**
   * Human-readable choice label.
   * @example "Bloco Branco"
   */
  readonly label: string;
  /** Optional color swatch rendered before the label, e.g. a material preview. */
  readonly swatchColor?: string;
  /**
   * Whether this chip is the active choice.
   * @default false
   */
  readonly selected?: boolean;
  /** Invoked when the chip is activated. Receives the chip's own next selected state, matching Ant Design's `CheckableTag` convention. */
  readonly onSelect?: (selected: boolean) => void;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

const swatchStyle = (color: string) => ({
  background: color,
  border: "1px solid rgba(0, 0, 0, 0.15)",
  borderRadius: "50%",
  display: "inline-block",
  height: 10,
  marginRight: 6,
  width: 10,
});

/**
 * One toggleable choice in a small set -- e.g. a material or preset picker --
 * built on Ant Design's `Tag.CheckableTag` rather than a bare `Tag`, since the
 * selectable behavior (not just the visual chip shape) is exactly what that
 * vendor primitive already models.
 *
 * @layer atom
 * @status stable
 */
export function SelectableChip(props: SelectableChipProps): ReactElement {
  return (
    <Tag.CheckableTag
      checked={props.selected ?? false}
      className={props.className}
      onChange={(checked) => props.onSelect?.(checked)}
    >
      {props.swatchColor !== undefined && <span style={swatchStyle(props.swatchColor)} />}
      {props.label}
    </Tag.CheckableTag>
  );
}
