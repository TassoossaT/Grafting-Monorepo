import { Tag } from "antd";

import type { StatusBadgeProps, UiStatus } from "../index.js";

const statusColors: Readonly<Record<UiStatus, string>> = {
  neutral: "default",
  info: "processing",
  success: "success",
  warning: "warning",
  error: "error",
};

export function StatusBadgeView(props: StatusBadgeProps) {
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
