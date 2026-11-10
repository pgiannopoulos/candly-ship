import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify X-Shopify-Hmac-Sha256 (base64 HMAC-SHA256 of the raw body). */
export function verifyShopifyHmac(rawBody: string | Buffer, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  const given = Buffer.from(hmacHeader, "base64");
  return given.length === digest.length && timingSafeEqual(given, digest);
}
