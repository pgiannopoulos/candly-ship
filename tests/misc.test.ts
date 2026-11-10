import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { codAmountFor, detectCod } from "@/lib/cod";
import { normalizePhone } from "@/lib/phone";
import { verifyShopifyHmac } from "@/lib/shopify/hmac";
import { nextStatus } from "@/lib/shopify/sync";
import { SETTING_DEFAULTS } from "@/lib/settings";

describe("detectCod", () => {
  const kw = SETTING_DEFAULTS.codGatewayKeywords;
  it("detects common COD gateway names", () => {
    expect(detectCod(["Cash on Delivery (COD)"], kw)).toBe(true);
    expect(detectCod(["Αντικαταβολή"], kw)).toBe(true);
    expect(detectCod(["shopify_payments"], kw)).toBe(false);
    expect(detectCod(["Viva Wallet"], kw)).toBe(false);
    expect(detectCod(["cod"], kw)).toBe(true);
    expect(detectCod(["Barcode"], kw)).toBe(false); // "cod" inside a word is not COD
  });
  it("computes amount", () => {
    expect(codAmountFor(true, 25.9, 25.9)).toBe(25.9);
    expect(codAmountFor(true, 0, 30)).toBe(30);
    expect(codAmountFor(false, 25.9, 25.9)).toBe(0);
  });
});

describe("normalizePhone", () => {
  it.each([
    ["+30 694 123 4567", "6941234567"],
    ["0030 210 1234567", "2101234567"],
    ["6941234567", "6941234567"],
    ["306941234567", "6941234567"],
    ["+49 151 1234567", "+491511234567"],
    ["", ""],
  ])("%s → %s", (i, o) => expect(normalizePhone(i)).toBe(o));
});

describe("verifyShopifyHmac", () => {
  it("accepts valid and rejects invalid signatures", () => {
    const body = JSON.stringify({ id: 1 });
    const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
    expect(verifyShopifyHmac(body, sig, "s3cret")).toBe(true);
    expect(verifyShopifyHmac(body, sig, "other")).toBe(false);
    expect(verifyShopifyHmac(body, null, "s3cret")).toBe(false);
  });
});

describe("nextStatus", () => {
  const o = { cancelledAt: null, requiresShipping: true, displayFulfillmentStatus: "UNFULFILLED", shippingAddress: {} as never };
  it("new order → NEW", () => expect(nextStatus(o, null)?.status).toBe("NEW"));
  it("never reverts a created voucher", () => expect(nextStatus(o, "VOUCHER")).toBeNull());
  it("cancelled before voucher → CANCELLED", () => expect(nextStatus({ ...o, cancelledAt: "x" }, "NEW")?.status).toBe("CANCELLED"));
  it("cancelled after voucher → keeps status with warning", () => {
    const r = nextStatus({ ...o, cancelledAt: "x" }, "PRINTED");
    expect(r?.status).toBe("PRINTED");
    expect(r?.note).toMatch(/GT/);
  });
  it("no shipping → SKIPPED", () => expect(nextStatus({ ...o, requiresShipping: false }, null)?.status).toBe("SKIPPED"));
});
