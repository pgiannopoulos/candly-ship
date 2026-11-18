import { Prisma, type OrderStatus } from "@prisma/client";
import { db } from "../db";
import { codAmountFor, detectCod } from "../cod";
import { getSettings, setSettings } from "../settings";
import { fetchOrder, fetchOrdersUpdatedSince, toLineItems, toShipAddress, type ShopifyOrder } from "./orders";

/** statusNote set when the admin moves a skipped order back to Νέες — stops the carrier rule from re-skipping it. */
export const RESTORED_NOTE = "Επαναφορά από διαχειριστή";

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]+/g, "");

/** True when the Shopify shipping method belongs to another carrier (e.g. BOX NOW), so no GT voucher is needed. */
export function isOtherCarrier(shippingTitle: string | null | undefined, keywordsCsv: string): boolean {
  if (!shippingTitle) return false;
  const title = norm(shippingTitle);
  return keywordsCsv
    .split(",")
    .map(norm)
    .filter(Boolean)
    .some((k) => title.includes(k));
}

export const otherCarrierNote = (title: string) => `Αποστολή με ${title} — όχι GT`;

/** Decide the middleware status for a Shopify order, without ever reverting our own progress. */
export function nextStatus(
  o: Pick<ShopifyOrder, "cancelledAt" | "requiresShipping" | "displayFulfillmentStatus" | "shippingAddress" | "shippingLine">,
  current: OrderStatus | null,
  opts: { otherCarrierKeywords?: string; restoredByAdmin?: boolean } = {},
): { status: OrderStatus; note: string | null } | null {
  const hasVoucher = current === "VOUCHER";
  if (o.cancelledAt) {
    return hasVoucher
      ? { status: current!, note: "Ακυρώθηκε στο Shopify — ακυρώστε και το voucher στο GT" }
      : { status: "CANCELLED", note: "Ακυρώθηκε στο Shopify" };
  }
  if (hasVoucher || current === "ERROR") return null; // keep ours
  if (current === "SKIPPED") return null;             // admin decision is sticky
  if (!o.requiresShipping || !o.shippingAddress) return { status: "SKIPPED", note: "Δεν απαιτείται αποστολή" };
  if (o.displayFulfillmentStatus === "FULFILLED" && current === null)
    return { status: "SKIPPED", note: "Ήδη εκτελεσμένη στο Shopify" };
  if (opts.restoredByAdmin) return null; // admin wants it in Νέες — keep NEW and the restore note
  const title = o.shippingLine?.title;
  if (title && isOtherCarrier(title, opts.otherCarrierKeywords ?? ""))
    return { status: "SKIPPED", note: otherCarrierNote(title) };
  return { status: "NEW", note: null };
}

export async function upsertShopifyOrder(o: ShopifyOrder) {
  const settings = await getSettings();
  const existing = await db.order.findUnique({ where: { shopifyId: o.id }, select: { status: true, statusNote: true } });
  const decided = nextStatus(o, existing?.status ?? null, {
    otherCarrierKeywords: settings.otherCarrierKeywords,
    restoredByAdmin: existing?.status === "NEW" && existing.statusNote === RESTORED_NOTE,
  });

  const total = Number(o.totalPriceSet.shopMoney.amount);
  const outstanding = Number(o.totalOutstandingSet?.shopMoney.amount ?? 0);
  const isCod = detectCod(o.paymentGatewayNames ?? [], settings.codGatewayKeywords);
  const lineItems = toLineItems(o);

  const data = {
    name: o.name,
    shopifyCreatedAt: new Date(o.createdAt),
    shopifyUpdatedAt: new Date(o.updatedAt),
    financialStatus: o.displayFinancialStatus,
    fulfillmentStatus: o.displayFulfillmentStatus,
    email: o.email,
    phone: o.phone,
    note: o.note,
    totalPrice: new Prisma.Decimal(total),
    currency: o.totalPriceSet.shopMoney.currencyCode,
    isCod,
    codAmount: new Prisma.Decimal(codAmountFor(isCod, outstanding, total)),
    totalWeightGrams: Math.round(Number(o.totalWeight ?? 0)),
    itemCount: lineItems.reduce((n, l) => n + l.quantity, 0),
    shippingTitle: o.shippingLine?.title ?? null,
    shippingAddress: (toShipAddress(o) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    lineItems: lineItems as unknown as Prisma.InputJsonValue,
    ...(decided ? { status: decided.status, statusNote: decided.note } : {}),
  };

  return db.order.upsert({
    where: { shopifyId: o.id },
    create: { shopifyId: o.id, ...data, status: decided?.status ?? "NEW" },
    update: data,
  });
}

export async function syncOrderById(gid: string) {
  const o = await fetchOrder(gid);
  if (o) await upsertShopifyOrder(o);
  return o;
}

/** Backfill: pull everything updated since the last sync (first run: last 14 days). */
export async function backfill(): Promise<number> {
  const s = await getSettings();
  const since = s.shopifyLastSyncAt || new Date(Date.now() - 14 * 864e5).toISOString();
  const started = new Date().toISOString();
  const orders = await fetchOrdersUpdatedSince(since);
  for (const o of orders) await upsertShopifyOrder(o);
  await setSettings({ shopifyLastSyncAt: started });
  await skipOtherCarrierOrders();
  return orders.length;
}

/**
 * Move waiting orders that ship with another carrier (BOX NOW etc.) out of Νέες.
 * Covers orders imported before the rule existed or before the keywords changed.
 * Orders the admin restored by hand, and ERROR orders (a GT attempt was made), are left alone.
 */
export async function skipOtherCarrierOrders(): Promise<number> {
  const { otherCarrierKeywords } = await getSettings();
  const waiting = await db.order.findMany({
    where: { status: "NEW", shippingTitle: { not: null } },
    select: { id: true, shippingTitle: true, statusNote: true },
  });
  const hits = waiting.filter((o) => o.statusNote !== RESTORED_NOTE && isOtherCarrier(o.shippingTitle, otherCarrierKeywords));
  for (const o of hits)
    await db.order.update({ where: { id: o.id }, data: { status: "SKIPPED", statusNote: otherCarrierNote(o.shippingTitle!) } });
  return hits.length;
}
