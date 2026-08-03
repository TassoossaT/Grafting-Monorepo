"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Explorer" },
  { href: "/lab", label: "Lab" },
  { href: "/registry", label: "Registry" },
  { href: "/agents", label: "Agents" },
  { href: "/storybook", label: "Storybook" },
] as const;

/** Persistent navigation shared by all four Architecture Studio surfaces (ADR-0016 + Storybook). */
export default function StudioNav() {
  const pathname = usePathname();

  return (
    <nav className="studio-nav" aria-label="Architecture Studio surfaces">
      <strong className="studio-nav-brand">Grafting Architecture Studio</strong>
      <div className="studio-nav-links">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
