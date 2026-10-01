import { ConfigProvider, theme } from "antd";
import type { ReactElement, ReactNode } from "react";

/** Public inputs for {@link UiThemeProvider}. */
export interface UiThemeProviderProps {
  /**
   * The UI below, whose components take the dark theme.
   * @example "<ActionDock ... />"
   */
  readonly children: ReactNode;
}

/**
 * Every colour a component reads text with is white, so text on any dark
 * surface -- a card, a menu, a popover -- is legible without the caller
 * styling it. The base is dark so a component with no surface of its own is
 * dark too, and not a light box on a dark page.
 */
const DARK_THEME = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorBgBase: "#0f172a",
    colorTextBase: "#ffffff",
    colorText: "#ffffff",
    colorTextHeading: "#ffffff",
    colorTextLabel: "#ffffff",
    colorTextSecondary: "#ffffff",
    colorTextTertiary: "#ffffff",
    colorTextDescription: "#ffffff",
    colorTextPlaceholder: "#e2e8f0",
  },
} as const;

/**
 * Gives every component of this package below it a dark theme with white
 * text, for an application whose page is dark. Wrap the UI once, near its
 * root; a component outside it keeps the default light theme.
 *
 * @layer atom
 * @status stable
 */
export function UiThemeProvider(props: UiThemeProviderProps): ReactElement {
  return <ConfigProvider theme={DARK_THEME}>{props.children}</ConfigProvider>;
}
