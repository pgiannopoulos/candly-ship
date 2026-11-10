import { env } from "../env";

/**
 * Read-only Shopify Admin GraphQL client.
 * Token: either a static SHOPIFY_ADMIN_TOKEN, or (Dev Dashboard apps) the client-credentials grant,
 * which returns a short-lived token that we cache and renew.
 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  const staticToken = env.shopAdminToken();
  if (staticToken) return staticToken;
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`https://${env.shopDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.shopClientId(),
      client_secret: env.shopClientSecret(),
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Shopify token request failed: HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}

export async function shopifyGql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const url = `https://${env.shopDomain()}/admin/api/${env.shopApiVersion()}/graphql.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (res.status === 401) cached = null;
    const j = (await res.json()) as { data?: T; errors?: unknown };
    if (!res.ok || j.errors) throw new Error(`Shopify GraphQL error: ${JSON.stringify(j.errors ?? res.status)}`);
    return j.data as T;
  }
  throw new Error("Shopify GraphQL: too many retries");
}
