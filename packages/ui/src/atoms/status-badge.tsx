import { Tag } from "antd";
import type { ReactElement } from "react";

import type { UiStatus } from "../shared-types.js";

/** Public inputs for a compact semantic status indicator. */
export interface StatusBadgeProps {
  /** Semantic state to present. */
  readonly status: UiStatus;
  /** Human-readable status label. */
  readonly label: string;
  /** Optional caller-owned class name for layout composition. */
  readonly className?: string;
}

const statusColors: Readonly<Record<UiStatus, string>> = {
  neutral: "default",
  info: "processing",
  success: "success",
  warning: "warning",
  error: "error",
};

/**
 * Semantic status marker with Grafting-owned status names.
 *
 * @layer atom
 * @status stable
 * @example Ready status
 * ```tsx
 * <StatusBadge status="success" label="Ready" />
 * ```
 */
export function StatusBadge(props: StatusBadgeProps): ReactElement {
  return (
    <Tag
      className={props.className}
      color={statusColors[props.status]}
      role="status"
      variant="filled"
    >
      {props.label}
    </Tag>
  );
}
