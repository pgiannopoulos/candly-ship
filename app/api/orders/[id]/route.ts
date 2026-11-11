import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { toDetail } from "@/lib/orderDto";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string) {
  const o = await db.order.findUnique({ where: { id }, include: { vouchers: { orderBy: { createdAt: "desc" } } } });
  return o ? toDetail(o, await getSettings()) : null;
}

export async function GET(_: Request, { params }: Ctx) {
  const d = await load((await params).id);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

const Address = z.object({
  name: z.string().min(1),
  company: z.string().nullish(),
  address1: z.string().min(1),
  address2: z.string().nullish(),
  city: z.string().min(1),
  province: z.string().nullish(),
  zip: z.string().min(1),
  country: z.string().nullish(),
  countryCode: z.string().nullish(),
  phone: z.string().nullish(),
});

const Patch = z.union([
  z.object({ action: z.literal("address"), address: Address }),
  z.object({ action: z.literal("resetAddress") }),
  z.object({
    action: z.literal("area"),
    area: z.object({ code: z.string().min(1), zone: z.string(), name: z.string(), zip: z.string().min(1) }),
  }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("unskip") }),
]);

/** Local edits only — nothing is written back to Shopify. */
export async function PATCH(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const p = parsed.data;
  const order = await db.order.findUniqueOrThrow({ where: { id } });

  const backToNew = order.status === "ERROR" ? { status: "NEW" as const, statusNote: null } : {};
  if (p.action === "address") {
    await db.order.update({ where: { id }, data: { addressOverride: p.address as Prisma.InputJsonValue, ...backToNew } });
    await audit("order.address_edited", order.name, id);
  } else if (p.action === "resetAddress") {
    await db.order.update({ where: { id }, data: { addressOverride: Prisma.DbNull } });
  } else if (p.action === "area") {
    const a = p.area;
    await db.order.update({
      where: { id },
      data: { gtAreaCode: a.code, gtZoneCode: a.zone, gtAreaName: a.name, gtAreaZip: a.zip.replace(/\s/g, ""), ...backToNew },
    });
  } else if (p.action === "skip") {
    await db.order.update({ where: { id }, data: { status: "SKIPPED", statusNote: "Παράλειψη από διαχειριστή" } });
    await audit("order.skipped", order.name, id);
  } else if (p.action === "unskip") {
    await db.order.update({ where: { id }, data: { status: "NEW", statusNote: null } });
  }
  return NextResponse.json(await load(id));
}
