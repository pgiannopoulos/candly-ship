"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrderRow, Tab } from "@/lib/orderDto";
import { Button, CodPill, StatusBadge, eur, shortDate } from "./ui";
import { OrderDrawer } from "./OrderDrawer";

const TAB_TIPS: Record<Tab, string> = {
  new: "Παραγγελίες που περιμένουν voucher (και όσες είχαν σφάλμα)",
  voucher: "Το voucher εκδόθηκε στο GT — το GT στέλνει με email το voucher της μεταφορικής",
  all: "Όλες οι παραγγελίες, μαζί με ακυρωμένες και παραλείψεις",
};

const TABS: { key: Tab; label: string }[] = [
  { key: "new", label: "Νέες" },
  { key: "voucher", label: "Εκδόθηκαν" },
  { key: "all", label: "Όλες" },
];

type Toast = { kind: "ok" | "err" | "info"; text: string } | null;

export function OrdersInbox() {
  const [tab, setTab] = useState<Tab>("new");
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [counts, setCounts] = useState<Record<Tab, number>>({ new: 0, voucher: 0, all: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState<null | "voucher" | "sync">(null);
  const [toast, setToast] = useState<Toast>(null);
  const knownNew = useRef<Set<string> | null>(null);

  const flash = useCallback((t: Toast) => {
    setToast(t);
    if (t) setTimeout(() => setToast((cur) => (cur === t ? null : cur)), t.kind === "err" ? 8000 : 4000);
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      const r = await fetch(`/api/orders?tab=${tab}&q=${encodeURIComponent(q)}`);
      if (r.ok) {
        const d = (await r.json()) as { orders: OrderRow[]; counts: Record<Tab, number> };
        setOrders(d.orders);
        setCounts(d.counts);
        if (tab === "new") {
          const ids = new Set(d.orders.map((o) => o.id));
          if (knownNew.current) {
            const fresh = d.orders.filter((o) => !knownNew.current!.has(o.id)).length;
            if (fresh > 0) flash({ kind: "info", text: fresh === 1 ? "✦ 1 νέα παραγγελία" : `✦ ${fresh} νέες παραγγελίες` });
          }
          knownNew.current = ids;
        }
      }
      setLoading(false);
    },
    [tab, q, flash],
  );

  useEffect(() => {
    setSelected(new Set());
    setCursor(0);
    const t = setTimeout(() => load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && load(true), 20_000);
    return () => clearInterval(t);
  }, [load]);

  const selectedRows = useMemo(() => orders.filter((o) => selected.has(o.id)), [orders, selected]);
  const canVoucher = selectedRows.filter((o) => o.status === "NEW" || o.status === "ERROR");

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allChecked = orders.length > 0 && orders.every((o) => selected.has(o.id));

  async function createVouchers(ids: string[]) {
    setBusy("voucher");
    const r = await fetch("/api/vouchers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: ids }) });
    const d = (await r.json()) as { results?: { ok: boolean; error?: string }[]; error?: string };
    setBusy(null);
    const ok = d.results?.filter((x) => x.ok).length ?? 0;
    const failed = d.results?.filter((x) => !x.ok) ?? [];
    if (failed.length) flash({ kind: "err", text: `${ok} vouchers εκδόθηκαν · ${failed.length} με σφάλμα: ${failed[0].error}` });
    else if (ok) flash({ kind: "ok", text: ok === 1 ? "Το voucher εκδόθηκε στο GT ✓" : `${ok} vouchers εκδόθηκαν στο GT ✓` });
    else flash({ kind: "err", text: d.error ?? "Αποτυχία" });
    setSelected(new Set());
    load(true);
  }

  async function sync() {
    setBusy("sync");
    const r = await fetch("/api/sync", { method: "POST" });
    const d = (await r.json()) as { count?: number; error?: string };
    setBusy(null);
    flash(r.ok ? { kind: "ok", text: d.count === 0 ? "Καμία αλλαγή στο Shopify" : d.count === 1 ? "1 παραγγελία ενημερώθηκε" : `${d.count} παραγγελίες ενημερώθηκαν` } : { kind: "err", text: d.error ?? "Αποτυχία" });
    load(true);
  }

  // Keyboard: j/k move · x select · enter open · v voucher · / search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (openId || tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      const cur = orders[cursor];
      if (e.key === "j") setCursor((c) => Math.min(c + 1, orders.length - 1));
      else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "x" && cur) toggle(cur.id);
      else if (e.key === "Enter" && cur) setOpenId(cur.id);
      else if (e.key === "/") {
        e.preventDefault();
        document.getElementById("search")?.focus();
      } else if (e.key === "v") {
        const ids = canVoucher.length ? canVoucher.map((o) => o.id) : cur && (cur.status === "NEW" || cur.status === "ERROR") ? [cur.id] : [];
        if (ids.length && !busy) createVouchers(ids);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div>
      {/* Title row */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-burgundy">Παραγγελίες</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {counts.new > 0 ? `${counts.new} περιμένουν voucher` : "Όλα έτοιμα για σήμερα ✦"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Αναζήτηση…"
            className="field w-64"
          />
          <Button variant="ghost" onClick={sync} loading={busy === "sync"} aria-label="Συγχρονισμός με Shopify" data-tip="Συγχρονισμός με Shopify: φέρνει τώρα τις νέες ή αλλαγμένες παραγγελίες" data-tip-align="end">
            ↻
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-6 border-b border-sand">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            data-tip={TAB_TIPS[t.key]}
            data-tip-align="start"
            className={`-mb-px border-b-2 pb-3 text-sm transition ${
              tab === t.key ? "border-burgundy font-semibold text-burgundy" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {t.label}
            <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] ${tab === t.key ? "bg-burgundy text-cream" : "bg-sand-50 text-ink-soft"}`}>
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-2xl border border-sand bg-white/50">
        <div className="grid grid-cols-[36px_88px_1fr_1fr_110px_110px_120px] items-center gap-3 border-b border-sand px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          <label className="flex" data-tip={allChecked ? "Αποεπιλογή όλων" : "Επιλογή όλων των παραγγελιών της λίστας"} data-tip-align="start">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={() => setSelected(allChecked ? new Set() : new Set(orders.map((o) => o.id)))}
              className="h-4 w-4 accent-burgundy"
              aria-label="Επιλογή όλων"
            />
          </label>
          <span>Αρ.</span>
          <span>Πελάτης</span>
          <span>Προορισμός</span>
          <span className="text-right">Σύνολο</span>
          <span />
          <span>Κατάσταση</span>
        </div>

        {loading && orders.length === 0 ? (
          <div className="space-y-px">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse bg-sand-50/60" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <Empty tab={tab} q={q} />
        ) : (
          orders.map((o, i) => (
            <div
              key={o.id}
              onClick={() => {
                setCursor(i);
                setOpenId(o.id);
              }}
              className={`group grid cursor-pointer grid-cols-[36px_88px_1fr_1fr_110px_110px_120px] items-center gap-3 border-b border-sand/60 px-4 py-3.5 text-sm transition last:border-0 hover:bg-sand-50/80 ${
                i === cursor ? "bg-sand-50/60 shadow-[inset_2px_0_0_var(--color-terracotta)]" : ""
              } ${selected.has(o.id) ? "bg-terracotta-soft/40" : ""}`}
            >
              <label
                className="flex"
                onClick={(e) => e.stopPropagation()}
                data-tip="Επιλογή για μαζική έκδοση vouchers (συντόμευση: x)"
                data-tip-align="start"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                  className="h-4 w-4 accent-burgundy"
                  aria-label={`Επιλογή ${o.name}`}
                />
              </label>
              <div>
                <div className="font-bold text-burgundy">{o.name}</div>
                <div className="text-[11px] text-ink-soft">{shortDate(o.createdAt)}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate font-medium">{o.customer}</div>
                <div className="text-[11px] text-ink-soft">
                  {o.itemCount} {o.itemCount === 1 ? "τεμάχιο" : "τεμάχια"}
                </div>
              </div>
              <div className="min-w-0 truncate text-ink-soft">
                {o.city} <span className="text-sand-600">·</span> {o.zip}
              </div>
              <div className="text-right font-semibold tabular-nums">{eur(o.total, o.currency)}</div>
              <div>{o.isCod && o.codAmount > 0 && <CodPill amount={o.codAmount} />}</div>
              <div className="min-w-0">
                <StatusBadge status={o.status} />
                {o.voucherNo ? (
                  <div className="truncate font-mono text-[11px] text-ink-soft">{o.voucherNo}</div>
                ) : o.statusNote ? (
                  <div className="truncate text-[11px] text-wine" title={o.statusNote}>
                    {o.statusNote}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <p className="no-print mt-4 text-center text-[11px] text-sand-600">
        <kbd>j</kbd>/<kbd>k</kbd> μετακίνηση · <kbd>x</kbd> επιλογή · <kbd>enter</kbd> άνοιγμα · <kbd>v</kbd> voucher · <kbd>/</kbd> αναζήτηση
      </p>

      {/* Floating action bar */}
      {selected.size > 0 && (
        <div className="animate-rise fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-sand bg-white/95 p-2 pl-5 shadow-[0_12px_40px_-12px_rgba(42,26,18,0.35)] backdrop-blur">
          <span className="mr-2 text-sm font-semibold">{selected.size} επιλεγμένες</span>
          <Button
            onClick={() => createVouchers(canVoucher.map((o) => o.id))}
            disabled={!canVoucher.length}
            loading={busy === "voucher"}
            data-tip-pos="top"
            data-tip={canVoucher.length ? "Εκδίδει voucher στο GT Courier για τις επιλεγμένες νέες παραγγελίες (συντόμευση: v)" : "Οι επιλεγμένες παραγγελίες έχουν ήδη voucher"}
          >
            Έκδοση vouchers{canVoucher.length ? ` (${canVoucher.length})` : ""}
          </Button>
          <Button variant="quiet" onClick={() => setSelected(new Set())} aria-label="Καθαρισμός επιλογής" data-tip="Καθαρισμός επιλογής" data-tip-pos="top">
            ✕
          </Button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`animate-rise fixed left-1/2 top-20 z-50 max-w-lg -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.kind === "err" ? "bg-wine text-cream" : toast.kind === "ok" ? "bg-forest text-cream" : "bg-burgundy text-cream"
          }`}
        >
          {toast.text}
        </div>
      )}

      {openId && (
        <OrderDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => load(true)}
          flash={flash}
        />
      )}
    </div>
  );
}

function Empty({ tab, q }: { tab: Tab; q: string }) {
  const text = q
    ? "Δεν βρέθηκαν παραγγελίες."
    : tab === "new"
      ? "Καμία παραγγελία σε αναμονή. Οι νέες παραγγελίες εμφανίζονται εδώ αυτόματα."
      : "Δεν υπάρχει τίποτα εδώ ακόμα.";
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
      <span className="text-3xl text-terracotta">✦</span>
      <p className="max-w-sm text-sm text-ink-soft">{text}</p>
    </div>
  );
}
