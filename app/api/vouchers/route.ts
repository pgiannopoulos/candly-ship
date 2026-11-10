import { NextResponse } from "next/server";
import { z } from "zod";
import { createVoucherForOrder, cancelVoucher, type VoucherResult } from "@/lib/vouchers";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 300;

const Create = z.object({
  orderIds: z.array(z.string()).min(1).max(100),
  options: z
    .object({
      pieces: z.number().int().min(1).max(99).optional(),
      weightKg: z.number().positive().max(999).optional(),
      codAmount: z.number().min(0).max(99999).optional(),
      notes: z.string().max(1000).optional(),
    })
    .optional(),
});

/** Create vouchers — one by one (GT is not built for parallel bursts), per-order results. */
export async function POST(req: Request) {
  const parsed = Create.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const { orderIds, options } = parsed.data;
  const results: VoucherResult[] = [];
  for (const id of orderIds) {
    // per-order options (weight, COD…) only make sense for a single order
    results.push(await createVoucherForOrder(id, orderIds.length === 1 ? options : undefined));
  }
  return NextResponse.json({ results });
}

const Cancel = z.object({ orderId: z.string() });

export async function DELETE(req: Request) {
  const parsed = Cancel.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "orderId required" }, { status: 400 });
  try {
    const s = await getSettings();
    await cancelVoucher(parsed.data.orderId, s.gtCancelStatus || undefined);
    return NextResponse.json({ ok: true, gtCancelled: !!s.gtCancelStatus });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
