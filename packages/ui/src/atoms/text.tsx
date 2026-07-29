import { Typography } from "antd";

import type { TextProps, TextTone } from "../index.js";

const toneColors: Readonly<Record<TextTone, string | undefined>> = {
  default: undefined,
  muted: "rgba(0, 0, 0, 0.58)",
  accent: "#1677ff",
  danger: "#ff4d4f",
};

export function TextView(props: TextProps) {
  const maxWidth = props.maxWidth === undefined ? "100%" : props.maxWidth;

  return (
    <Typography.Text
      className={props.className}
      ellipsis={props.truncate ? { tooltip: props.tooltip ?? props.content } : false}
      strong={props.strong}
      style={{
        color: toneColors[props.tone ?? "default"],
        display: "block",
        maxWidth,
        minWidth: 0,
      }}
    >
      {props.content}
    </Typography.Text>
  );
}
