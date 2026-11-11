function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export const env = {
  appUrl: () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  appSecret: () => req("APP_SECRET"),
  adminPasswordHash: () => Buffer.from(req("ADMIN_PASSWORD_HASH"), "base64").toString("utf8"),

  shopDomain: () => req("SHOPIFY_STORE_DOMAIN"),
  shopApiVersion: () => process.env.SHOPIFY_API_VERSION || "2026-10",
  shopAdminToken: () => process.env.SHOPIFY_ADMIN_TOKEN || "",
  shopClientId: () => process.env.SHOPIFY_CLIENT_ID || "",
  shopClientSecret: () => process.env.SHOPIFY_CLIENT_SECRET || "",
  shopWebhookSecret: () => process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET || "",
  shopifyConfigured: () => !!process.env.SHOPIFY_STORE_DOMAIN && !!(process.env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_CLIENT_ID),

  gtHost: () => req("GT_API_HOST").replace(/\/$/, ""),
  gtMock: () => process.env.GT_MOCK === "1",
};
