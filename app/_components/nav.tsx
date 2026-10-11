"use client";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/payouts", label: "Payouts" },
  { href: "/agent", label: "Agent runs" },
  { href: "/how", label: "How it works" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <a key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
            {l.label}
          </a>
        );
      })}
    </nav>
  );
}
