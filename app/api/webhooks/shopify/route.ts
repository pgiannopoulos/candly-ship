import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyShopifyHmac } from "@/lib/shopify/hmac";
import { syncOrderById } from "@/lib/shopify/sync";
import { setSettings } from "@/lib/settings";

export const runtime = "nodejs";

/**
 * Shopify → orders/create, orders/updated, orders/cancelled.
 * We only take the order id from the payload and re-read the order via GraphQL,
 * so webhooks and the periodic backfill share one code path.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyShopifyHmac(raw, req.headers.get("x-shopify-hmac-sha256"), env.shopWebhookSecret())) {
    return NextResponse.json({ error: "invalid hmac" }, { status: 401 });
  }

  const webhookId = req.headers.get("x-shopify-webhook-id") ?? crypto.randomUUID();
  const topic = req.headers.get("x-shopify-topic") ?? "unknown";
  try {
    await db.webhookEvent.create({ data: { id: webhookId, topic } });
  } catch {
    return NextResponse.json({ ok: true, duplicate: true }); // already processed
  }

  const payload = JSON.parse(raw) as { admin_graphql_api_id?: string; id?: number };
  const gid = payload.admin_graphql_api_id ?? (payload.id ? `gid://shopify/Order/${payload.id}` : null);

  // Respond fast (Shopify expects < 5s); process right after.
  if (gid) {
    queueMicrotask(() => {
      syncOrderById(gid)
        .then(() => setSettings({ shopifyLastWebhookAt: new Date().toISOString() }))
        .catch((e) => console.error("[webhook] sync failed", gid, e));
    });
  }
  return NextResponse.json({ ok: true });
}
