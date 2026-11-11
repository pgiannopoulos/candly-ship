import { NextResponse } from "next/server";
import { backfill } from "@/lib/shopify/sync";
import { registerWebhooks } from "@/lib/shopify/orders";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Manual "Συγχρονισμός τώρα": backfill + make sure webhooks are registered. */
export async function POST() {
  if (!env.shopifyConfigured()) return NextResponse.json({ error: "Το Shopify δεν έχει ρυθμιστεί (.env)" }, { status: 400 });
  try {
    const count = await backfill();
    let webhooks: string[] = [];
    if (env.appUrl().startsWith("https://")) webhooks = await registerWebhooks(`${env.appUrl()}/api/webhooks/shopify`);
    await audit("shopify.sync", `${count} παραγγελίες ενημερώθηκαν`);
    return NextResponse.json({ ok: true, count, webhooks });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
