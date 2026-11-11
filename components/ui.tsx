"use client";
import type { ButtonHTMLAttributes } from "react";

export const eur = (n: number, currency = "EUR") =>
  new Intl.NumberFormat("el-GR", { style: "currency", currency }).format(n);

export const shortDate = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const t = d.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return sameDay ? `Σήμερα ${t}` : `${d.toLocaleDateString("el-GR", { day: "numeric", month: "short" })} ${t}`;
};

type Variant = "primary" | "ghost" | "quiet" | "danger";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-burgundy text-cream hover:bg-burgundy-hover disabled:bg-sand-600",
  ghost: "border border-sand bg-white/60 text-ink hover:border-sand-600 hover:bg-white",
  quiet: "text-ink-soft hover:text-burgundy hover:bg-sand-50",
  danger: "text-wine hover:bg-wine/5",
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return <span className={`${className} inline-block animate-spin rounded-full border-2 border-current border-r-transparent`} />;
}

export function CodPill({ amount }: { amount: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-terracotta-soft px-2 py-0.5 text-[11px] font-bold text-terracotta">
      Αντ/λή {eur(amount)}
    </span>
  );
}

const STATUS: Record<string, { label: string; dot: string; text: string }> = {
  NEW: { label: "Νέα", dot: "bg-terracotta", text: "text-ink" },
  VOUCHER: { label: "Εκδόθηκε", dot: "bg-forest", text: "text-forest" },
  ERROR: { label: "Σφάλμα", dot: "bg-wine", text: "text-wine" },
  CANCELLED: { label: "Ακυρώθηκε", dot: "bg-sand", text: "text-ink-soft line-through" },
  SKIPPED: { label: "Παράλειψη", dot: "bg-sand", text: "text-ink-soft" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.NEW;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
