import Link from "next/link";
import { listGtStatuses, sampleGtVouchers } from "@/lib/gt/vouchers";

export const dynamic = "force-dynamic";

/**
 * Discovery page: shows the raw latest vouchers and status list from GT so we can confirm
 * the r18 field mapping (create one voucher by hand in Pegasus first, then open this page).
 */
export default async function DebugPage() {
  const run = async (f: () => Promise<unknown>) => {
    try {
      return { ok: true, data: await f() };
    } catch (e) {
      return { ok: false, data: e instanceof Error ? e.message : String(e) };
    }
  };
  const [vouchers, statuses] = await Promise.all([run(() => sampleGtVouchers(3)), run(listGtStatuses)]);

  return (
    <div className="space-y-6">
      <Link href="/settings" className="text-xs font-semibold text-terracotta">← Ρυθμίσεις</Link>
      <h1 className="text-2xl font-bold text-burgundy">Διάγνωση GT</h1>
      <p className="max-w-2xl text-sm text-ink-soft">
        Τα πραγματικά πεδία των πρόσφατων vouchers του λογαριασμού σας στο GT (p04, p014, p0204…) και οι κωδικοί καταστάσεων — για
        να επιβεβαιώσουμε τους κωδικούς των Ρυθμίσεων. Το GT δείχνει μόνο vouchers του τελευταίου μήνα.
      </p>
      <Block title="Τελευταία vouchers — GET /hermes_api/courier/r18/all" r={vouchers} />
      <Block title="Καταστάσεις — GET /hermes_api/courier/r14" r={statuses} />
    </div>
  );
}

function Block({ title, r }: { title: string; r: { ok: boolean; data: unknown } }) {
  return (
    <section className="rounded-2xl border border-sand bg-white/50 p-5">
      <h2 className="mb-3 text-sm font-bold">{title}</h2>
      <pre className={`max-h-[480px] overflow-auto rounded-xl bg-sand-50 p-4 text-xs ${r.ok ? "text-ink" : "text-wine"}`}>
        {typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2)}
      </pre>
    </section>
  );
}
