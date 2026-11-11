import { db } from "./db";

/**
 * Admin-editable settings (stored in DB, edited in /settings).
 * GT codes must be provided by GT Courier — see README "What to ask GT Courier".
 */
export const SETTING_DEFAULTS = {
  // GT Hermes codes (all optional — GT applies the account defaults when empty)
  gtWorkType: "",            // p04  — work type: 001 = sender pays, 002 = recipient pays (empty = GT's first applicable)
  gtShipmentKind: "2",       // p126 — 1=Order / 2=Send / 3=Receive
  gtInitialStatus: "",       // p014 — initial status code (empty = GT default)
  gtSenderCrmCode: "",       // p0100 — sender CRM person/branch id (optional)
  gtCancelStatus: "",        // p014 status code that cancels a voucher (e.g. AKY); empty = cancel only locally
  // Sender (Candly) — leave address/postcode empty to use the details of the GT account
  senderName: "Candly",
  senderAddress: "",
  senderArea: "",
  senderPostcode: "",
  senderPhone: "",
  senderEmail: "",
  // Defaults
  defaultPieces: "1",
  defaultWeightKg: "1",
  useShopifyWeight: "1",
  codGatewayKeywords: "cash on delivery,cod,αντικαταβολή,antikatavoli",
  // Sync bookkeeping
  shopifyLastSyncAt: "",
  shopifyLastWebhookAt: "",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type Settings = Record<SettingKey, string>;

export async function getSettings(): Promise<Settings> {
  const rows = await db.setting.findMany();
  const out = { ...SETTING_DEFAULTS } as Settings;
  for (const r of rows) if (r.key in out) out[r.key as SettingKey] = r.value;
  return out;
}

export async function setSettings(patch: Partial<Settings>) {
  await db.$transaction(
    Object.entries(patch)
      .filter(([k, v]) => k in SETTING_DEFAULTS && v !== undefined)
      .map(([key, value]) =>
        db.setting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } }),
      ),
  );
}
