/**
 * Runs once when the Next.js server starts: periodic Shopify backfill (every 10 min)
 * so orders are never missed even if a webhook is lost, plus webhook registration.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { env } = await import("./lib/env");
  if (!env.shopifyConfigured()) {
    console.log("[candly-ship] Shopify not configured — background sync disabled");
    return;
  }
  const { backfill } = await import("./lib/shopify/sync");
  const { registerWebhooks } = await import("./lib/shopify/orders");

  const run = async () => {
    try {
      const n = await backfill();
      if (n) console.log(`[candly-ship] backfill: ${n} orders`);
    } catch (e) {
      console.error("[candly-ship] backfill failed", e);
    }
  };

  setTimeout(async () => {
    if (env.appUrl().startsWith("https://")) {
      try {
        console.log("[candly-ship] webhooks:", (await registerWebhooks(`${env.appUrl()}/api/webhooks/shopify`)).join(", "));
      } catch (e) {
        console.error("[candly-ship] webhook registration failed", e);
      }
    }
    await run();
  }, 5_000);
  setInterval(run, 10 * 60_000);
}
