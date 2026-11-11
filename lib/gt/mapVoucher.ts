import type { LineItem, ShipAddress } from "../types";
import type { Settings } from "../settings";
import { normalizePhone } from "../phone";

/**
 * Pure mapping: one Shopify order → form fields for POST /hermes_api/courier/r18 (GT Hermes API).
 * Fields: docs/hermes-api-guide.md and https://www.tesae.gr/pegasus-hermes-rest-api
 */
export type AreaCodes = { code: string; zone: string };

export type VoucherInput = {
  orderName: string;          // "#1042"
  email?: string | null;
  address: ShipAddress;
  lineItems: LineItem[];
  pieces: number;
  weightKg: number;
  codAmount: number;          // 0 = no COD
  notes?: string | null;      // notes for the courier / recipient
  recipientArea: AreaCodes;   // from make_zonearea for the recipient postcode
  senderArea?: AreaCodes | null; // only when the sender is sent explicitly (else GT uses the account's details)
};

const cut = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const money = (n: number) => n.toFixed(2);

export class VoucherValidationError extends Error {}

export function validateVoucherInput(v: Omit<VoucherInput, "recipientArea"> & { recipientArea?: AreaCodes }): string[] {
  const errs: string[] = [];
  if (!v.address?.name?.trim()) errs.push("Λείπει το όνομα παραλήπτη");
  if (!v.address?.address1?.trim()) errs.push("Λείπει η διεύθυνση");
  if (!v.address?.city?.trim()) errs.push("Λείπει η περιοχή/πόλη");
  if (!/^\d{3}\s?\d{2}$/.test((v.address?.zip ?? "").trim()) && (v.address?.countryCode ?? "GR") === "GR")
    errs.push("Μη έγκυρος ΤΚ (5 ψηφία)");
  if (!normalizePhone(v.address?.phone)) errs.push("Λείπει τηλέφωνο παραλήπτη");
  if (!(v.pieces >= 1)) errs.push("Τα τεμάχια πρέπει να είναι ≥ 1");
  if (!(v.weightKg > 0)) errs.push("Το βάρος πρέπει να είναι > 0");
  if (v.codAmount < 0) errs.push("Μη έγκυρο ποσό αντικαταβολής");
  return errs;
}

/** True when Settings hold a full sender address; otherwise GT fills the sender from the logged-in account. */
export const hasExplicitSender = (s: Settings) => !!(s.senderAddress.trim() && s.senderPostcode.trim());

export function mapVoucher(v: VoucherInput, s: Settings): Record<string, string> {
  const errs = validateVoucherInput(v);
  if (!v.recipientArea?.code) errs.push("Δεν έχει επιλεγεί περιοχή GT για τον ΤΚ");
  if (errs.length) throw new VoucherValidationError(errs.join(" · "));

  const a = v.address;
  const street = [a.address1, a.address2].filter(Boolean).join(", ");
  const recipientTitle = a.company ? `${a.name} (${a.company})` : a.name;
  const cod = Math.round(v.codAmount * 100) / 100;

  const f: Record<string, string> = {
    p126: s.gtShipmentKind || "2",                       // 1 = order, 2 = send, 3 = receive
    p125: cut(v.orderName, 15),                          // order number (our Shopify #)
    p120: String(Math.max(1, Math.round(v.pieces))),     // pieces
    p101: String(Math.round(v.weightKg * 1000) / 1000),  // weight kg

    // Recipient
    p0201: cut(recipientTitle, 60),
    p0202: cut(street, 100),
    p0203: cut(a.city, 40),
    p0208: a.zip.replace(/\s/g, ""),
    p0204country: (a.countryCode || "GR").toUpperCase(),
    p0204: v.recipientArea.code,                         // service area (r07p01)
    p0205: v.recipientArea.zone,                         // zone (r02p01)
    p0206: normalizePhone(a.phone),
    p0210: cut(v.email, 60),
    p0207: cut(v.notes, 500),
  };

  if (cod > 0) f.p022 = money(cod);                      // cash on delivery, cash

  // Sender: only when filled in Settings (with its own area); otherwise GT uses the account's details
  if (hasExplicitSender(s) && v.senderArea?.code) {
    Object.assign(f, {
      p0101: cut(s.senderName, 60),
      p0102: cut(s.senderAddress, 100),
      p0103: cut(s.senderArea, 40),
      p0108: s.senderPostcode.replace(/\s/g, ""),
      p0104country: "GR",
      p0104: v.senderArea.code,
      p0105: v.senderArea.zone,
      p0106: normalizePhone(s.senderPhone),
      p0110: cut(s.senderEmail, 60),
    });
  }

  // GT codes (only sent when configured)
  if (s.gtSenderCrmCode) f.p0100 = s.gtSenderCrmCode;
  if (s.gtWorkType) f.p04 = s.gtWorkType;
  if (s.gtInitialStatus) f.p014 = s.gtInitialStatus;

  // Drop empty optional fields so GT defaults apply
  for (const k of Object.keys(f)) if (f[k] === "") delete f[k];
  return f;
}
