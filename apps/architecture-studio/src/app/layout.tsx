import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import StudioNav from "./studio-nav.tsx";

export const metadata: Metadata = {
  title: "Grafting Architecture Studio",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StudioNav />
        <div className="studio-shell-content">{children}</div>
      </body>
    </html>
  );
}
