"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/orders", label: "Παραγγελίες", tip: "Λίστα παραγγελιών, vouchers και εκτυπώσεις" },
  { href: "/settings", label: "Ρυθμίσεις", tip: "Σύνδεση GT, στοιχεία αποστολέα και προεπιλογές" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active = path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            data-tip={l.tip}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              active ? "bg-burgundy text-cream" : "text-ink-soft hover:bg-sand-50 hover:text-ink"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
