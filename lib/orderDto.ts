import type { Order, OrderStatus, Voucher, Prisma } from "@prisma/client";
import { db } from "./db";
import type { LineItem, ShipAddress } from "./types";
import { defaultWeightKg } from "./vouchers";
import type { Settings } from "./settings";

export type Tab = "new" | "voucher" | "printed" | "all";
export const TAB_STATUSES: Record<Tab, OrderStatus[] | null> = {
  new: ["NEW", "ERROR"],
  voucher: ["VOUCHER"],
  printed: ["PRINTED"],
  all: null,
};

export type OrderRow = {
  id: string;
  name: string;
  createdAt: string;
  status: OrderStatus;
  statusNote: string | null;
  customer: string;
  city: string;
  zip: string;
  itemCount: number;
  total: number;
  currency: string;
  isCod: boolean;
  codAmount: number;
  voucherNo: string | null;
  printedAt: string | null;
};

export type OrderDetail = OrderRow & {
  email: string | null;
  phone: string | null;
  note: string | null;
  shippingTitle: string | null;
  financialStatus: string | null;
  address: ShipAddress | null;
  addressEdited: boolean;
  lineItems: LineItem[];
  defaults: { pieces: number; weightKg: number };
  vouchers: { id: string; voucherNo: string | null; createdAt: string; error: string | null; cancelledAt: string | null; printedAt: string | null }[];
};

type WithVouchers = Order & { vouchers: Voucher[] };

const activeVoucher = (o: WithVouchers) => o.vouchers.find((v) => !v.error && !v.cancelledAt && v.voucherNo) ?? null;

export function toRow(o: WithVouchers): OrderRow {
  const a = (o.addressOverride ?? o.shippingAddress) as ShipAddress | null;
  const v = activeVoucher(o);
  return {
    id: o.id,
    name: o.name,
    createdAt: o.shopifyCreatedAt.toISOString(),
    status: o.status,
    statusNote: o.statusNote,
    customer: a?.name || o.email || "—",
    city: a?.city ?? "",
    zip: a?.zip ?? "",
    itemCount: o.itemCount,
    total: Number(o.totalPrice),
    currency: o.currency,
    isCod: o.isCod,
    codAmount: Number(o.codAmount),
    voucherNo: v?.voucherNo ?? null,
    printedAt: v?.printedAt?.toISOString() ?? null,
  };
}

export function toDetail(o: WithVouchers, s: Settings): OrderDetail {
  return {
    ...toRow(o),
    email: o.email,
    phone: o.phone,
    note: o.note,
    shippingTitle: o.shippingTitle,
    financialStatus: o.financialStatus,
    address: (o.addressOverride ?? o.shippingAddress) as ShipAddress | null,
    addressEdited: !!o.addressOverride,
    lineItems: o.lineItems as unknown as LineItem[],
    defaults: { pieces: Number(s.defaultPieces) || 1, weightKg: defaultWeightKg(o.totalWeightGrams, s) },
    vouchers: o.vouchers.map((v) => ({
      id: v.id,
      voucherNo: v.voucherNo,
      createdAt: v.createdAt.toISOString(),
      error: v.error,
      cancelledAt: v.cancelledAt?.toISOString() ?? null,
      printedAt: v.printedAt?.toISOString() ?? null,
    })),
  };
}

export async function listOrders(tab: Tab, q: string) {
  const statuses = TAB_STATUSES[tab];
  const search: Prisma.OrderWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { shippingAddress: { path: ["name"], string_contains: q } },
          { vouchers: { some: { voucherNo: { contains: q } } } },
        ],
      }
    : {};
  const [orders, grouped] = await Promise.all([
    db.order.findMany({
      where: { ...(statuses ? { status: { in: statuses } } : {}), ...search },
      include: { vouchers: { orderBy: { createdAt: "desc" } } },
      orderBy: { shopifyCreatedAt: tab === "new" ? "asc" : "desc" },
      take: 300,
    }),
    db.order.groupBy({ by: ["status"], _count: true }),
  ]);
  const c = Object.fromEntries(grouped.map((g) => [g.status, g._count])) as Partial<Record<OrderStatus, number>>;
  const counts = {
    new: (c.NEW ?? 0) + (c.ERROR ?? 0),
    voucher: c.VOUCHER ?? 0,
    printed: c.PRINTED ?? 0,
    all: Object.values(c).reduce((a, b) => a + (b ?? 0), 0),
  };
  return { orders: orders.map(toRow), counts };
}
