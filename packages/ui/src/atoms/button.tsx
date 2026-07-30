import { Button } from "antd";
import type { ReactElement } from "react";

import type { ButtonProps } from "../index.js";

export function ButtonView(props: ButtonProps): ReactElement {
  return (
    <Button
      className={props.className}
      onClick={props.onClick}
      size="small"
      type={props.tone === "accent" ? "primary" : "default"}
    >
      {props.label}
    </Button>
  );
}
