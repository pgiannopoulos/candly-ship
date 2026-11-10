import type { LineItem, ShipAddress } from "../types";
import type { Settings } from "../settings";
import { normalizePhone } from "../phone";

/**
 * Pure mapping: one Shopify order → form fields for POST /api/courier00/r18 (Pegasus).
 * Field names/sizes come from the Pegasus REST docs (tesae.gr/pegasus-webapp-rest-api, "Vouchers r18").
 */
export type VoucherInput = {
  orderName: string;          // "#1042"
  email?: string | null;
  address: ShipAddress;
  lineItems: LineItem[];
  pieces: number;
  weightKg: number;
  codAmount: number;          // 0 = no COD
  notes?: string | null;      // notes for the courier / recipient
  date?: Date;
};

const cut = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const ymd = (d: Date) => {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const money = (n: number) => n.toFixed(2);

export class VoucherValidationError extends Error {}

export function validateVoucherInput(v: VoucherInput): string[] {
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

export function mapVoucher(v: VoucherInput, s: Settings): Record<string, string> {
  const errs = validateVoucherInput(v);
  if (errs.length) throw new VoucherValidationError(errs.join(" · "));

  const a = v.address;
  const zip = a.zip.replace(/\s/g, "");
  const phone = normalizePhone(a.phone);
  const street = [a.address1, a.address2].filter(Boolean).join(", ");
  const recipientTitle = a.company ? `${a.name} (${a.company})` : a.name;
  const cod = Math.round(v.codAmount * 100) / 100;
  const commodities = v.lineItems.map((l) => `${l.quantity}× ${l.name}`).join(", ");

  const f: Record<string, string> = {
    p015: ymd(v.date ?? new Date()),            // Ημερομηνία
    p125: cut(v.orderName, 15),                  // Αριθμός Εντολής (our order #)
    p126: s.gtShipmentKind || "2",               // Είδος: 2 = Αποστολή
    p124: "2",                                   // 1=Φάκελος / 2=Δέμα
    p120: String(Math.max(1, Math.round(v.pieces))), // Τεμάχια
    p101: v.weightKg.toFixed(3),                 // Βάρος (kg)

    // Sender (Candly)
    p0101: cut(s.senderName, 60),
    p0102: cut(s.senderAddress, 100),
    p0103: cut(s.senderArea, 40),
    p0108_1: cut(s.senderPostcode.replace(/\s/g, ""), 20),
    p0106: cut(normalizePhone(s.senderPhone), 20),
    p0110: cut(s.senderEmail, 60),

    // Recipient
    p03: cut(a.name, 30),                        // Επαφή
    p0201: cut(recipientTitle, 60),              // Διακριτικός Τίτλος Παραλήπτη
    p0202: cut(street, 100),                     // Διεύθυνση
    p0203: cut(a.city, 40),                      // Περιοχή
    p0208_1: cut(zip, 20),                       // ΤΚ (string)
    p0206: cut(phone, 20),                       // Τηλέφωνο 1
    p0210: cut(v.email, 60),                     // e-mail
    p0207: cut(v.notes, 1000),                   // Σημειώσεις Παραλήπτη
    p018: cut(v.notes, 100),                     // Παρατηρήσεις

    pdc03: cut(commodities, 350),                // Commodities
    pdl02: s.gtSendSms === "1" ? "1" : "0",      // Αποστολή SMS

    // Cash on delivery
    p026: cod > 0 ? "1" : "0",
    p022: money(cod > 0 ? cod : 0),              // Ποσό Αντικαταβολής σε Μετρητά
  };

  if (/^\d{1,7}$/.test(zip)) f.p0208 = zip;      // numeric ΤΚ field (7)
  if (/^\d{1,7}$/.test(s.senderPostcode.replace(/\s/g, ""))) f.p0108 = s.senderPostcode.replace(/\s/g, "");
  if (cod > 0) f.p021 = `Αντικαταβολή ${money(cod).replace(".", ",")} € — παραγγελία ${v.orderName}`;

  // GT-provided codes (only sent when configured)
  if (s.gtCustomerCode) f.p02 = s.gtCustomerCode;
  if (s.gtCustomerBranch) f.p02_1 = s.gtCustomerBranch;
  if (s.gtSenderCrmCode) f.p0100 = s.gtSenderCrmCode;
  if (s.gtWorkType) f.p04 = s.gtWorkType;
  if (s.gtInitialStatus) f.p014 = s.gtInitialStatus;

  // Drop empty optional fields so GT defaults apply
  for (const k of Object.keys(f)) if (f[k] === "") delete f[k];
  return f;
}
