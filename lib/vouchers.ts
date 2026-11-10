import { Prisma } from "@prisma/client";
import { db } from "./db";
import { audit } from "./audit";
import { getSettings, type Settings } from "./settings";
import { mapVoucher, VoucherValidationError } from "./gt/mapVoucher";
import { createGtVoucher, findGtVoucherByOrder, printGtVoucher, mergePdfs, setGtVoucherStatus } from "./gt/vouchers";
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
      fields = mapVoucher(
        {
          orderName: order.name,
          email: order.email,
          address,
          lineItems: order.lineItems as unknown as LineItem[],
          pieces,
          weightKg,
          codAmount,
          notes,
        },
        s,
      );
    } catch (e) {
      const msg = e instanceof VoucherValidationError ? e.message : String(e);
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

      // Pre-fetch the label so printing is instant (non-fatal)
      fetchAndStoreLabel(v.id, s).catch(() => {});
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

async function fetchAndStoreLabel(voucherId: string, s?: Settings) {
  const settings = s ?? (await getSettings());
  const v = await db.voucher.findUniqueOrThrow({ where: { id: voucherId } });
  if (v.labelPdf) return new Uint8Array(v.labelPdf);
  if (!v.gtNr01) throw new Error("Το voucher δεν έχει κωδικό GT");
  const pdf = await printGtVoucher(v.gtNr01, settings.gtPrintTable, settings.gtPrintForm || undefined);
  await db.voucher.update({ where: { id: voucherId }, data: { labelPdf: Buffer.from(pdf) } });
  return pdf;
}

/** Returns one PDF with the labels of all given orders (in order) and marks them printed. */
export async function labelsForOrders(orderIds: string[]): Promise<{ pdf: Uint8Array; missing: string[] }> {
  const settings = await getSettings();
  const pdfs: Uint8Array[] = [];
  const missing: string[] = [];
  for (const id of orderIds) {
    const v = await db.voucher.findFirst({
      where: { orderId: id, error: null, cancelledAt: null, gtNr01: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { order: { select: { name: true } } },
    });
    if (!v) {
      missing.push(id);
      continue;
    }
    pdfs.push(await fetchAndStoreLabel(v.id, settings));
    await db.voucher.update({ where: { id: v.id }, data: { printedAt: new Date() } });
    await db.order.update({ where: { id }, data: { status: "PRINTED" } });
  }
  if (!pdfs.length) throw new Error("Δεν βρέθηκαν vouchers για εκτύπωση");
  await audit("labels.printed", `${pdfs.length} ετικέτες`);
  return { pdf: pdfs.length === 1 ? pdfs[0] : await mergePdfs(pdfs), missing };
}

/** Cancel locally (and at GT if a cancel status code is configured). Order returns to "Νέες". */
export async function cancelVoucher(orderId: string, gtCancelStatus?: string) {
  const v = await db.voucher.findFirst({ where: { orderId, error: null, cancelledAt: null }, orderBy: { createdAt: "desc" } });
  if (!v) return;
  if (gtCancelStatus && v.gtNr01) await setGtVoucherStatus(v.gtNr01, gtCancelStatus);
  await db.voucher.update({ where: { id: v.id }, data: { cancelledAt: new Date() } });
  const o = await db.order.update({ where: { id: orderId }, data: { status: "NEW", statusNote: null } });
  await audit("voucher.cancelled", `${o.name} (${v.voucherNo})${gtCancelStatus ? "" : " — μόνο τοπικά"}`, orderId);
}
