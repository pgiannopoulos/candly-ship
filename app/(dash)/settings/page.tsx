import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSettings, setSettings, SETTING_DEFAULTS, type SettingKey } from "@/lib/settings";
import { gtConnectionStatus, connectGt, disconnectGt } from "@/lib/gt/client";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { SyncButton } from "@/components/SyncButton";

export const dynamic = "force-dynamic";

async function save(formData: FormData) {
  "use server";
  const patch: Partial<Record<SettingKey, string>> = {};
  for (const [k, v] of formData.entries()) {
    if (k in SETTING_DEFAULTS && typeof v === "string") patch[k as SettingKey] = v.trim();
  }
  // checkboxes: absent = off
  for (const cb of ["useShopifyWeight"] as const) {
    if (formData.has(`${cb}__present`)) patch[cb] = formData.get(cb) ? "1" : "0";
  }
  await setSettings(patch);
  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

async function connect(formData: FormData) {
  "use server";
  const username = String(formData.get("gtUsername") ?? "").trim();
  let password = String(formData.get("gtPassword") ?? "");
  // Empty password = keep the stored one (e.g. re-test after GT fixed something on their side)
  if (!password) {
    const a = await db.gtAccount.findUnique({ where: { id: 1 } });
    if (a && a.username === username) password = decrypt(a.password);
  }
  if (!username || !password) redirect("/settings?gt_error=" + encodeURIComponent("Συμπληρώστε όνομα χρήστη και κωδικό"));
  let error: string | null = null;
  try {
    await connectGt(username, password);
    await audit("gt.connected", username);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/", "layout");
  redirect(error ? "/settings?gt_error=" + encodeURIComponent(error) : "/settings?gt_connected=1");
}

async function disconnect() {
  "use server";
  await disconnectGt();
  await audit("gt.disconnected");
  revalidatePath("/", "layout");
}

const fmt = (d?: Date | string | null) =>
  d ? new Date(d).toLocaleString("el-GR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const [s, gt, logs] = await Promise.all([
    getSettings(),
    gtConnectionStatus(),
    db.auditLog.findMany({ orderBy: { at: "desc" }, take: 12 }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-[28px] font-bold tracking-tight text-burgundy">Ρυθμίσεις</h1>
        <p className="mt-1 text-sm text-ink-soft">Σύνδεση με GT Courier, στοιχεία αποστολέα και προεπιλογές.</p>
      </div>

      {sp.saved && <Banner kind="ok">Οι ρυθμίσεις αποθηκεύτηκαν.</Banner>}
      {sp.gt_connected && <Banner kind="ok">Συνδεθήκατε με το GT Courier ✦</Banner>}
      {sp.gt_error && <Banner kind="err">GT Courier: {sp.gt_error}</Banner>}

      {/* GT connection */}
      <Card>
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-lg font-bold">GT Courier</h2>
            {gt.connected ? (
              <p className="mt-1 text-sm text-forest">
                ● Συνδεδεμένο ως <b>{gt.username}</b> από {fmt(gt.connectedAt)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-wine">● {gt.lastError ?? "Δεν υπάρχει σύνδεση."}</p>
            )}
          </div>
          {gt.username && (
            <form action={disconnect}>
              <button className="text-xs text-ink-soft hover:text-wine" data-tip="Διαγράφει τα στοιχεία σύνδεσης GT από την εφαρμογή" data-tip-align="end">
                Αποσύνδεση
              </button>
            </form>
          )}
        </div>
        <form action={connect} className="mt-5 grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="label" htmlFor="gtUsername">Όνομα χρήστη API</label>
            <input id="gtUsername" name="gtUsername" defaultValue={gt.username ?? ""} autoComplete="off" className="field" />
          </div>
          <div>
            <label className="label" htmlFor="gtPassword">Κωδικός</label>
            <input
              id="gtPassword"
              name="gtPassword"
              type="password"
              autoComplete="new-password"
              placeholder={gt.username ? "•••••• (αποθηκευμένος)" : ""}
              className="field"
            />
          </div>
          <button className="rounded-xl bg-burgundy px-4 py-2.5 text-sm font-semibold text-cream hover:bg-burgundy-hover" data-tip="Ελέγχει τα στοιχεία με το GT και τα αποθηκεύει κρυπτογραφημένα" data-tip-align="end">
            {gt.username ? "Επανασύνδεση" : "Σύνδεση"}
          </button>
        </form>
        <p className="mt-3 text-xs text-ink-soft">
          Τα στοιχεία του Hermes API που σας έδωσε το GT. Ο κωδικός αποθηκεύεται κρυπτογραφημένος και η εφαρμογή ξανασυνδέεται μόνη της όταν λήξει η
          σύνδεση. {env.gtMock() && <b className="text-terracotta">Λειτουργία δοκιμής (GT_MOCK=1).</b>}
        </p>
      </Card>

      <form action={save} className="space-y-8">
        <Card title="Κωδικοί GT" hint="Όλοι προαιρετικοί — αν μείνουν κενοί, το GT χρησιμοποιεί τις προεπιλογές του λογαριασμού σας.">
          <Grid>
            <F name="gtWorkType" s={s} hint="p04 · 001 = χρέωση αποστολέα" />
            <F name="gtShipmentKind" s={s} hint="p126 · 2 = Αποστολή" />
            <F name="gtCancelStatus" s={s} hint="p014 · π.χ. AKY · κενό = μόνο τοπικά" />
            <F name="gtInitialStatus" s={s} hint="p014 · κενό = προεπιλογή GT" />
            <F name="gtSenderCrmCode" s={s} hint="p0100 · προαιρετικό" />
          </Grid>
        </Card>

        <Card title="Αποστολέας" hint="Αφήστε κενή τη διεύθυνση ή τον ΤΚ για να χρησιμοποιηθούν τα στοιχεία του λογαριασμού GT. Αν τα συμπληρώσετε, στέλνονται σε κάθε voucher.">
          <Grid>
            <F name="senderName" s={s} />
            <F name="senderPhone" s={s} />
            <F name="senderAddress" s={s} />
            <F name="senderArea" s={s} />
            <F name="senderPostcode" s={s} />
            <F name="senderEmail" s={s} />
          </Grid>
        </Card>

        <Card title="Προεπιλογές" hint="Συμπληρώνονται αυτόματα — αλλάζουν ανά παραγγελία.">
          <Grid>
            <F name="defaultPieces" s={s} />
            <F name="defaultWeightKg" s={s} />
          </Grid>
          <Check name="useShopifyWeight" s={s} label="Χρήση βάρους προϊόντων από το Shopify όταν υπάρχει" />
          <div className="mt-4">
            <F name="codGatewayKeywords" s={s} hint="λέξεις στο όνομα του τρόπου πληρωμής Shopify, χωρισμένες με κόμμα" />
          </div>
        </Card>

        <div className="flex justify-end">
          <button className="rounded-xl bg-burgundy px-6 py-2.5 text-sm font-semibold text-cream hover:bg-burgundy-hover" data-tip="Αποθηκεύει όλες τις παραπάνω ρυθμίσεις" data-tip-pos="top" data-tip-align="end">Αποθήκευση</button>
        </div>
      </form>

      <Card title="Shopify">
        <div className="flex items-center justify-between gap-6 text-sm">
          <div className="space-y-1 text-ink-soft">
            <p>
              Κατάστημα: <b className="text-ink">{process.env.SHOPIFY_STORE_DOMAIN || "δεν έχει ρυθμιστεί"}</b>
            </p>
            <p>Τελευταίο webhook: {fmt(s.shopifyLastWebhookAt || null)}</p>
            <p>Τελευταίος συγχρονισμός: {fmt(s.shopifyLastSyncAt || null)}</p>
            <p className="text-xs">Μόνο ανάγνωση — η εφαρμογή δεν αλλάζει τίποτα στο Shopify.</p>
          </div>
          <SyncButton />
        </div>
      </Card>

      <Card title="Πρόσφατη δραστηριότητα">
        <ul className="divide-y divide-sand/70 text-sm">
          {logs.length === 0 && <li className="py-2 text-ink-soft">—</li>}
          {logs.map((l) => (
            <li key={l.id} className="flex gap-4 py-2">
              <span className="w-28 shrink-0 text-xs text-ink-soft">{fmt(l.at)}</span>
              <span className="w-36 shrink-0 font-mono text-xs text-terracotta">{l.action}</span>
              <span className="truncate text-ink-soft">{l.detail}</span>
            </li>
          ))}
        </ul>
        <Link href="/settings/debug" className="mt-4 inline-block text-xs font-semibold text-terracotta hover:text-burgundy">
          Διάγνωση GT (πεδία voucher, καταστάσεις) →
        </Link>
      </Card>
    </div>
  );
}

const LABELS: Record<SettingKey, string> = {
  gtSenderCrmCode: "Κωδικός CRM αποστολέα",
  gtWorkType: "Είδος εργασίας",
  gtInitialStatus: "Αρχική κατάσταση",
  gtShipmentKind: "Είδος",
  gtCancelStatus: "Κατάσταση ακύρωσης",
  senderName: "Επωνυμία",
  senderAddress: "Διεύθυνση",
  senderArea: "Περιοχή",
  senderPostcode: "ΤΚ",
  senderPhone: "Τηλέφωνο",
  senderEmail: "E-mail",
  defaultPieces: "Τεμάχια",
  defaultWeightKg: "Βάρος (kg)",
  useShopifyWeight: "Βάρος Shopify",
  codGatewayKeywords: "Λέξεις αντικαταβολής",
  shopifyLastSyncAt: "",
  shopifyLastWebhookAt: "",
};

function Card({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-sand bg-white/50 p-6">
      {title && <h2 className="text-lg font-bold">{title}</h2>}
      {hint && <p className="mb-5 mt-0.5 text-xs text-ink-soft">{hint}</p>}
      {title && !hint && <div className="mb-4" />}
      {children}
    </section>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;

function F({ name, s, hint }: { name: SettingKey; s: Record<SettingKey, string>; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {LABELS[name]} {hint && <span className="font-normal normal-case tracking-normal text-sand-600">· {hint}</span>}
      </label>
      <input id={name} name={name} defaultValue={s[name]} className="field" />
    </div>
  );
}

function Check({ name, s, label }: { name: SettingKey; s: Record<SettingKey, string>; label: string }) {
  return (
    <label className="mt-4 flex items-center gap-2 text-sm">
      <input type="hidden" name={`${name}__present`} value="1" />
      <input type="checkbox" name={name} defaultChecked={s[name] === "1"} className="h-4 w-4 accent-burgundy" />
      {label}
    </label>
  );
}

function Banner({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl px-4 py-3 text-sm font-medium ${kind === "ok" ? "bg-forest-soft text-forest" : "bg-wine/5 text-wine"}`}>{children}</div>
  );
}
