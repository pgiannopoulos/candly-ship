import { db } from "./db";

/**
 * Admin-editable settings (stored in DB, edited in /settings).
 * GT codes must be provided by GT Courier — see README "What to ask GT Courier".
 */
export const SETTING_DEFAULTS = {
  // GT / Pegasus codes
  gtCustomerCode: "",        // p02  — Candly's customer code at GT
  gtSenderCrmCode: "",       // p0100 — sender CRM code (optional if sender sent inline)
  gtCustomerBranch: "",      // p02_1 — optional
  gtWorkType: "",            // p04  — work type code (e.g. standard parcel)
  gtInitialStatus: "",       // p014 — initial status code (leave empty to let GT default)
  gtShipmentKind: "2",       // p126 — 1=Order / 2=Shipment / 3=Pickup
  gtCancelStatus: "",        // p014 status code that cancels a voucher (ask GT); empty = cancel only locally
  gtPrintTable: "",          // tbl  — data-table id of r18 for /prints/print
  gtPrintForm: "",           // p85  — print form id (10x15 label)
  gtTrackingUrl: "",         // e.g. https://www.gtcourier.gr/track?voucher={voucher}
  gtSendSms: "1",            // pdl02 — ask GT to SMS the recipient
  // Sender (Candly)
  senderName: "Candly",
  senderAddress: "",
  senderArea: "Αθήνα",
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
