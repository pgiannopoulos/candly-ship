import type { Order, OrderStatus, Voucher, Prisma } from "@prisma/client";
import { db } from "./db";
import type { LineItem, ShipAddress } from "./types";
import { defaultWeightKg } from "./vouchers";
import type { Settings } from "./settings";

export type Tab = "new" | "voucher" | "all";
export const TAB_STATUSES: Record<Tab, OrderStatus[] | null> = {
  new: ["NEW", "ERROR"],
  voucher: ["VOUCHER"],
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
  /** GT area chosen for the current postcode (null = not chosen yet, or chosen for a different postcode) */
  gtArea: { code: string; zone: string; name: string } | null;
  vouchers: { id: string; voucherNo: string | null; createdAt: string; error: string | null; cancelledAt: string | null }[];
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
  };
}

export function toDetail(o: WithVouchers, s: Settings): OrderDetail {
  const a = (o.addressOverride ?? o.shippingAddress) as ShipAddress | null;
  const zip = (a?.zip ?? "").replace(/\s/g, "");
  return {
    ...toRow(o),
    gtArea:
      o.gtAreaCode && o.gtAreaZip === zip ? { code: o.gtAreaCode, zone: o.gtZoneCode ?? "", name: o.gtAreaName ?? o.gtAreaCode } : null,
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
      orderBy: { shopifyCreatedAt: "desc" },
      take: 300,
    }),
    db.order.groupBy({ by: ["status"], _count: true }),
  ]);
  const c = Object.fromEntries(grouped.map((g) => [g.status, g._count])) as Partial<Record<OrderStatus, number>>;
  const counts = {
    new: (c.NEW ?? 0) + (c.ERROR ?? 0),
    voucher: c.VOUCHER ?? 0,
    all: Object.values(c).reduce((a, b) => a + (b ?? 0), 0),
  };
  return { orders: orders.map(toRow), counts };
}
