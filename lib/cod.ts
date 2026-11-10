/**
 * Decide whether a Shopify order is Cash-on-Delivery (αντικαταβολή).
 * Shopify marks manual payment methods via paymentGatewayNames, e.g. ["Cash on Delivery (COD)"].
 */
export function detectCod(
  gatewayNames: string[],
  keywordsCsv: string,
): boolean {
  const keywords = keywordsCsv
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  return gatewayNames.some((g) => {
    const name = g.toLowerCase();
    return keywords.some((k) => (k.length <= 3 ? new RegExp(`(^|[^\\p{L}\\p{N}])${k}($|[^\\p{L}\\p{N}])`, "u").test(name) : name.includes(k)));
  });
}

/** Amount to collect: what is still outstanding on the order (never negative). */
export function codAmountFor(isCod: boolean, totalOutstanding: number, totalPrice: number): number {
  if (!isCod) return 0;
  const amt = Number.isFinite(totalOutstanding) && totalOutstanding > 0 ? totalOutstanding : totalPrice;
  return Math.max(0, Math.round(amt * 100) / 100);
}
