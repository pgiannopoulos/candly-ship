import { Prisma, type Order } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { getSettings, type Settings } from "./settings";
import { mapVoucher, validateVoucherInput, hasExplicitSender, VoucherValidationError, type AreaCodes } from "./gt/mapVoucher";
import { resolveArea } from "./gt/areas";
import { createGtVoucher, findGtVoucherByOrder, setGtVoucherStatus, gtVoucherStatus } from "./gt/vouchers";
import type { LineItem, ShipAddress } from "./types";

export type VoucherOptions = { pieces?: number; weightKg?: number; codAmount?: number; notes?: string };
export type VoucherResult =
  | { ok: true; orderId: string; voucherId: string; voucherNo: string; adopted?: boolean }
  | { ok: false; orderId: string; error: string };

const inFlight = new Set<string>();

export function defaultWeightKg(totalWeightGrams: number, s: Settings) {
  if (s.useShopifyWeight === "1" && totalWeightGrams > 0) return Math.max(0.1, Math.round(totalWeightGrams) / 1000);
  return Number(s.defaultWeightKg) || 1;
}

export async function createVoucherForOrder(orderId: string, opts: VoucherOptions = {}): Promise<VoucherResult> {
  if (inFlight.has(orderId)) return { ok: false, orderId, error: "Η δημιουργία voucher είναι ήδη σε εξέλιξη" };
  inFlight.add(orderId);
  try {
    const s = await getSettings();
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { vouchers: { where: { error: null, cancelledAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (order.status === "CANCELLED") return { ok: false, orderId, error: "Η παραγγελία έχει ακυρωθεί" };
    const active = order.vouchers[0];
    if (active?.voucherNo) return { ok: true, orderId, voucherId: active.id, voucherNo: active.voucherNo };

    const address = (order.addressOverride ?? order.shippingAddress) as ShipAddress | null;
    if (!address) return { ok: false, orderId, error: "Η παραγγελία δεν έχει διεύθυνση αποστολής" };

    const pieces = opts.pieces ?? (Number(s.defaultPieces) || 1);
    const weightKg = opts.weightKg ?? defaultWeightKg(order.totalWeightGrams, s);
    const codAmount = opts.codAmount ?? Number(order.codAmount);
    const notes = opts.notes ?? order.note ?? undefined;

    let fields: Record<string, string>;
    try {
      const input = {
        orderName: order.name,
        email: order.email,
        address,
        lineItems: order.lineItems as unknown as LineItem[],
        pieces,
        weightKg,
        codAmount,
        notes,
      };
      // Check the address first, so a typo is reported before asking GT about areas
      const errs = validateVoucherInput(input);
      if (errs.length) throw new VoucherValidationError(errs.join(" · "));
      const recipientArea = await recipientAreaFor(order, address);
      const senderArea = hasExplicitSender(s) ? await senderAreaFor(s) : null;
      fields = mapVoucher({ ...input, recipientArea, senderArea }, s);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.order.update({ where: { id: orderId }, data: { status: "ERROR", statusNote: msg } });
      return { ok: false, orderId, error: msg };
    }

    const base = {
      orderId,
      pieces,
      weightKg: new Prisma.Decimal(weightKg),
      codAmount: new Prisma.Decimal(codAmount),
      notes: notes ?? null,
      request: fields as Prisma.InputJsonValue,
    };

    try {
      // Never create a duplicate: if GT already has a voucher for this order number, adopt it.
      let existing = await findGtVoucherByOrder(order.name).catch(() => null);
      if (existing) {
        const wasCancelled = await db.voucher.count({ where: { orderId, gtNr01: existing.nr01, cancelledAt: { not: null } } });
        if (wasCancelled) existing = null; // it's the one we cancelled — create a fresh one
      }
      const created = existing?.nr01
        ? { nr01: existing.nr01, voucherNo: existing.voucherNo ?? existing.nr01, raw: { adopted: true } }
        : await createGtVoucher(fields);

      const v = await db.voucher.create({
        data: { ...base, gtNr01: created.nr01, voucherNo: created.voucherNo, response: created.raw as Prisma.InputJsonValue },
      });
      await db.order.update({ where: { id: orderId }, data: { status: "VOUCHER", statusNote: null } });
      await audit(existing ? "voucher.adopted" : "voucher.created", `${order.name} → ${created.voucherNo}`, orderId);

      return { ok: true, orderId, voucherId: v.id, voucherNo: created.voucherNo, adopted: !!existing };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const body = (e as { body?: unknown }).body;
      await db.voucher.create({ data: { ...base, error: msg, response: (body ?? null) as Prisma.InputJsonValue } });
      await db.order.update({ where: { id: orderId }, data: { status: "ERROR", statusNote: msg } });
      await audit("voucher.error", `${order.name}: ${msg}`, orderId);
      return { ok: false, orderId, error: msg };
    }
  } finally {
    inFlight.delete(orderId);
  }
}

/** The recipient's GT area: the one chosen in the order, or picked automatically from postcode + city. */
async function recipientAreaFor(order: Order, address: ShipAddress): Promise<AreaCodes> {
  const zip = address.zip.replace(/\s/g, "");
  if (order.gtAreaCode && order.gtZoneCode && order.gtAreaZip === zip) return { code: order.gtAreaCode, zone: order.gtZoneCode };
  const { options, picked } = await resolveArea(zip, address.city, (address.countryCode || "GR").toUpperCase());
  if (!options.length) throw new VoucherValidationError(`Ο ΤΚ ${zip} δεν βρέθηκε στο GT — ελέγξτε τον ΤΚ`);
  if (!picked)
    throw new VoucherValidationError(
      `Ο ΤΚ ${zip} ανήκει σε περισσότερες περιοχές GT (${options.map((o) => o.name).join(", ")}) — επιλέξτε «Περιοχή GT» στην παραγγελία`,
    );
  await db.order.update({
    where: { id: order.id },
    data: { gtAreaCode: picked.code, gtZoneCode: picked.zone, gtAreaName: picked.name, gtAreaZip: zip },
  });
  return { code: picked.code, zone: picked.zone };
}

async function senderAreaFor(s: Settings): Promise<AreaCodes> {
  const { options, picked } = await resolveArea(s.senderPostcode, s.senderArea);
  if (!picked)
    throw new VoucherValidationError(
      options.length
        ? `Ο ΤΚ αποστολέα ανήκει σε πολλές περιοχές GT (${options.map((o) => o.name).join(", ")}) — γράψτε μία από αυτές στο «Περιοχή» του αποστολέα στις Ρυθμίσεις`
        : "Ο ΤΚ αποστολέα δεν βρέθηκε στο GT — ελέγξτε τις Ρυθμίσεις",
    );
  return { code: picked.code, zone: picked.zone };
}

/**
 * What happened at GT when cancelling:
 *  cancelled = GT now reports the cancel status · ignored = GT accepted the request but the status did not change
 *  gone = GT no longer has the voucher · failed = GT refused (message in `gtError`) · local = no cancel code configured
 */
export type CancelOutcome = { gt: "cancelled" | "ignored" | "gone" | "failed" | "local"; gtError?: string };

/** Cancel in the app (always) and try at GT when a cancel status code is configured. Order returns to "Νέες". */
export async function cancelVoucher(orderId: string, gtCancelStatus?: string): Promise<CancelOutcome> {
  const v = await db.voucher.findFirst({ where: { orderId, error: null, cancelledAt: null }, orderBy: { createdAt: "desc" } });
  if (!v) return { gt: "local" };

  let out: CancelOutcome = { gt: "local" };
  if (gtCancelStatus && v.gtNr01 && v.voucherNo) {
    try {
      await setGtVoucherStatus(v.gtNr01, gtCancelStatus);
    } catch (e) {
      out = { gt: "failed", gtError: e instanceof Error ? e.message : String(e) };
    }
    // GT answers "OK" even when it ignores the status → check what it really reports now
    const now = await gtVoucherStatus(v.voucherNo).catch(() => undefined);
    if (now === null) out = { gt: "gone" };
    else if (now && now.toUpperCase() === gtCancelStatus.toUpperCase()) out = { gt: "cancelled" };
    else if (out.gt !== "failed") out = { gt: "ignored" };
  }

  await db.voucher.update({ where: { id: v.id }, data: { cancelledAt: new Date() } });
  const o = await db.order.update({ where: { id: orderId }, data: { status: "NEW", statusNote: null } });
  const note = { cancelled: "", gone: " — δεν υπάρχει πλέον στο GT", local: " — μόνο τοπικά", ignored: " — το GT δεν το ακύρωσε", failed: ` — GT: ${out.gtError}` }[out.gt];
  await audit("voucher.cancelled", `${o.name} (${v.voucherNo})${note}`, orderId);
  return out;
}
