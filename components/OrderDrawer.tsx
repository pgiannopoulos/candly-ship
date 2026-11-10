"use client";
import { useEffect, useState } from "react";
import type { OrderDetail } from "@/lib/orderDto";
import type { ShipAddress } from "@/lib/types";
import { Button, CodPill, Spinner, StatusBadge, eur, shortDate } from "./ui";

type Props = {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onPrint: (id: string) => Promise<void> | void;
  flash: (t: { kind: "ok" | "err" | "info"; text: string }) => void;
};

export function OrderDrawer({ id, onClose, onChanged, onPrint, flash }: Props) {
  const [o, setO] = useState<OrderDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState<ShipAddress | null>(null);
  const [pieces, setPieces] = useState(1);
  const [weight, setWeight] = useState(1);
  const [cod, setCod] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (d: OrderDetail) => {
    setO(d);
    setAddr(d.address);
    setPieces(d.defaults.pieces);
    setWeight(d.defaults.weightKg);
    setCod(d.isCod ? d.codAmount : 0);
    setNotes(d.note ?? "");
    setError(d.status === "ERROR" ? d.statusNote : null);
  };

  useEffect(() => {
    fetch(`/api/orders/${id}`).then(async (r) => r.ok && apply(await r.json()));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id, onClose]);

  async function patch(body: object) {
    const r = await fetch(`/api/orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Αποτυχία");
    apply(d);
    onChanged();
  }

  async function saveAddress() {
    setBusy("addr");
    try {
      await patch({ action: "address", address: addr });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  async function createVoucher() {
    setBusy("voucher");
    setError(null);
    const r = await fetch("/api/vouchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds: [id], options: { pieces, weightKg: weight, codAmount: cod, notes: notes || undefined } }),
    });
    const d = (await r.json()) as { results?: { ok: boolean; error?: string; voucherNo?: string }[]; error?: string };
    const res = d.results?.[0];
    if (res?.ok) flash({ kind: "ok", text: `Voucher ${res.voucherNo}` });
    else setError(res?.error ?? d.error ?? "Αποτυχία");
    const fresh = await fetch(`/api/orders/${id}`).then((x) => x.json());
    apply(fresh);
    if (!res?.ok) setError(res?.error ?? d.error ?? "Αποτυχία");
    setBusy(null);
    onChanged();
  }

  async function print() {
    setBusy("print");
    await onPrint(id);
    setBusy(null);
    setTimeout(() => fetch(`/api/orders/${id}`).then(async (r) => r.ok && apply(await r.json())), 900);
  }

  async function cancel() {
    if (!confirm("Ακύρωση του voucher; Η παραγγελία θα επιστρέψει στις Νέες.")) return;
    setBusy("cancel");
    const r = await fetch("/api/vouchers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: id }) });
    const d = await r.json();
    if (!r.ok) setError(d.error);
    else flash({ kind: "info", text: d.gtCancelled ? "Το voucher ακυρώθηκε και στο GT" : "Ακυρώθηκε τοπικά — ακυρώστε το και στο GT" });
    const fresh = await fetch(`/api/orders/${id}`).then((x) => x.json());
    apply(fresh);
    setBusy(null);
    onChanged();
  }

  const active = o?.vouchers.find((v) => v.voucherNo && !v.error && !v.cancelledAt);
  const canCreate = o && (o.status === "NEW" || o.status === "ERROR");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="animate-fade absolute inset-0 bg-ink/20 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="animate-slide-in relative flex h-full w-full max-w-[460px] flex-col border-l border-sand bg-cream shadow-2xl">
        {!o ? (
          <div className="grid flex-1 place-items-center text-ink-soft">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between border-b border-sand px-7 py-6">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-2xl font-bold tracking-tight text-burgundy">{o.name}</h2>
                  <StatusBadge status={o.status} />
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  {shortDate(o.createdAt)} · {eur(o.total, o.currency)} · {o.shippingTitle ?? "—"}
                </p>
              </div>
              <button onClick={onClose} className="rounded-full p-1.5 text-ink-soft hover:bg-sand-50 hover:text-ink" aria-label="Κλείσιμο">
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-7 overflow-y-auto px-7 py-6">
              {/* Voucher hero */}
              {active && (
                <section className="rounded-2xl bg-forest-soft p-5">
                  <p className="label !text-forest">Voucher GT Courier</p>
                  <p className="font-mono text-2xl font-bold tracking-wide text-forest">{active.voucherNo}</p>
                  <p className="mt-1 text-xs text-forest/80">
                    {active.printedAt ? `Εκτυπώθηκε ${shortDate(active.printedAt)}` : `Δημιουργήθηκε ${shortDate(active.createdAt)}`}
                  </p>
                  <div className="mt-4 flex gap-2">
                    <Button onClick={print} loading={busy === "print"} className="!bg-forest hover:!bg-forest/90">
                      Εκτύπωση ετικέτας
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(active.voucherNo!);
                        flash({ kind: "info", text: "Αντιγράφηκε" });
                      }}
                    >
                      Αντιγραφή
                    </Button>
                    <Button variant="danger" onClick={cancel} loading={busy === "cancel"} className="ml-auto">
                      Ακύρωση
                    </Button>
                  </div>
                </section>
              )}

              {o.statusNote && o.status !== "ERROR" && (
                <p className="rounded-xl bg-terracotta-soft px-4 py-2.5 text-sm text-terracotta">{o.statusNote}</p>
              )}

              {/* Recipient */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="label !mb-0">Παραλήπτης {o.addressEdited && <span className="normal-case tracking-normal text-terracotta">· διορθωμένη</span>}</h3>
                  {canCreate && !editing && (
                    <button onClick={() => setEditing(true)} className="text-xs font-semibold text-terracotta hover:text-burgundy">
                      Διόρθωση
                    </button>
                  )}
                </div>
                {editing && addr ? (
                  <div className="space-y-2.5 rounded-2xl border border-sand bg-white/60 p-4">
                    <Field label="Ονοματεπώνυμο" value={addr.name} onChange={(v) => setAddr({ ...addr, name: v })} />
                    <Field label="Διεύθυνση" value={addr.address1} onChange={(v) => setAddr({ ...addr, address1: v })} />
                    <Field label="Συμπλ. διεύθυνσης" value={addr.address2 ?? ""} onChange={(v) => setAddr({ ...addr, address2: v })} />
                    <div className="grid grid-cols-[1fr_110px] gap-2.5">
                      <Field label="Περιοχή" value={addr.city} onChange={(v) => setAddr({ ...addr, city: v })} />
                      <Field label="ΤΚ" value={addr.zip} onChange={(v) => setAddr({ ...addr, zip: v })} />
                    </div>
                    <Field label="Τηλέφωνο" value={addr.phone ?? ""} onChange={(v) => setAddr({ ...addr, phone: v })} />
                    <p className="text-[11px] text-ink-soft">Η διόρθωση αφορά μόνο το voucher — δεν αλλάζει την παραγγελία στο Shopify.</p>
                    <div className="flex gap-2 pt-1">
                      <Button onClick={saveAddress} loading={busy === "addr"}>Αποθήκευση</Button>
                      <Button variant="quiet" onClick={() => { setEditing(false); setAddr(o.address); }}>Άκυρο</Button>
                      {o.addressEdited && (
                        <Button variant="quiet" className="ml-auto" onClick={() => patch({ action: "resetAddress" }).then(() => setEditing(false))}>
                          Επαναφορά Shopify
                        </Button>
                      )}
                    </div>
                  </div>
                ) : o.address ? (
                  <div className="text-[15px] leading-relaxed">
                    <p className="font-semibold">{o.address.name}{o.address.company ? ` · ${o.address.company}` : ""}</p>
                    <p>{[o.address.address1, o.address.address2].filter(Boolean).join(", ")}</p>
                    <p>{o.address.zip} {o.address.city}{o.address.countryCode && o.address.countryCode !== "GR" ? `, ${o.address.country}` : ""}</p>
                    <p className="mt-1 text-sm text-ink-soft">{o.address.phone || o.phone || "χωρίς τηλέφωνο"} · {o.email}</p>
                  </div>
                ) : (
                  <p className="text-sm text-ink-soft">Χωρίς διεύθυνση αποστολής</p>
                )}
              </section>

              {/* Items */}
              <section>
                <h3 className="label">Προϊόντα</h3>
                <ul className="divide-y divide-sand/70 rounded-2xl border border-sand bg-white/50">
                  {o.lineItems.map((l, i) => (
                    <li key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                      <span className="truncate">{l.name}</span>
                      <span className="ml-3 font-semibold text-ink-soft">×{l.quantity}</span>
                    </li>
                  ))}
                </ul>
                {o.note && <p className="mt-3 rounded-xl bg-sand-50 px-4 py-2.5 text-sm italic text-ink-soft">“{o.note}”</p>}
              </section>

              {/* Shipment */}
              {canCreate && (
                <section className="space-y-3">
                  <h3 className="label">Αποστολή</h3>
                  <div className="grid grid-cols-3 gap-2.5">
                    <NumField label="Τεμάχια" value={pieces} step={1} min={1} onChange={setPieces} />
                    <NumField label="Βάρος (kg)" value={weight} step={0.1} min={0.1} onChange={setWeight} />
                    <NumField label="Αντ/λή (€)" value={cod} step={0.01} min={0} onChange={setCod} highlight={cod > 0} />
                  </div>
                  {o.isCod ? (
                    <div className="flex items-center gap-2 text-xs text-ink-soft">
                      <CodPill amount={o.codAmount} /> πληρωμή με αντικαταβολή στο Shopify
                    </div>
                  ) : cod > 0 ? (
                    <p className="text-xs text-terracotta">Προσοχή: η παραγγελία είναι ήδη πληρωμένη στο Shopify.</p>
                  ) : null}
                  <div>
                    <label className="label">Σημειώσεις για τον courier</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="field resize-none" placeholder="π.χ. κουδούνι 3ος όροφος" />
                  </div>
                </section>
              )}

              {error && (
                <div className="rounded-xl border border-wine/20 bg-wine/5 px-4 py-3 text-sm text-wine">
                  <p className="font-semibold">Σφάλμα GT Courier</p>
                  <p className="mt-0.5">{error}</p>
                </div>
              )}

              {o.vouchers.length > (active ? 1 : 0) && (
                <section>
                  <h3 className="label">Ιστορικό</h3>
                  <ul className="space-y-1 text-xs text-ink-soft">
                    {o.vouchers.filter((v) => v !== active).map((v) => (
                      <li key={v.id}>
                        {shortDate(v.createdAt)} · {v.error ? <span className="text-wine">σφάλμα: {v.error}</span> : `${v.voucherNo}${v.cancelledAt ? " (ακυρώθηκε)" : ""}`}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 border-t border-sand bg-cream/90 px-7 py-4">
              {canCreate ? (
                <>
                  <Button onClick={createVoucher} loading={busy === "voucher"} disabled={editing} className="flex-1 py-3">
                    Δημιουργία voucher
                  </Button>
                  <Button variant="quiet" onClick={() => patch({ action: "skip" })} title="Δεν χρειάζεται αποστολή">
                    Παράλειψη
                  </Button>
                </>
              ) : o.status === "SKIPPED" ? (
                <Button variant="ghost" onClick={() => patch({ action: "unskip" })} className="flex-1">
                  Επαναφορά στις Νέες
                </Button>
              ) : (
                <Button variant="ghost" onClick={onClose} className="flex-1">
                  Κλείσιμο
                </Button>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="field" />
    </div>
  );
}

function NumField({
  label, value, onChange, step, min, highlight,
}: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; highlight?: boolean }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(value) ? value : ""}
        step={step}
        min={min}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className={`field tabular-nums ${highlight ? "!border-terracotta/60 !bg-terracotta-soft/50 font-semibold text-terracotta" : ""}`}
      />
    </div>
  );
}
