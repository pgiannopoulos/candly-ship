import { gtRequest, GtError } from "./client";
import { findStr } from "./parse";

export type CreatedVoucher = { nr01: string; voucherNo: string; raw: unknown };

/** POST /courier/r18 → create the voucher at GT. Returns nr01 (internal id) and p01 (voucher number). */
export async function createGtVoucher(fields: Record<string, string>): Promise<CreatedVoucher> {
  const { body } = await gtRequest("/courier/r18", { form: fields });
  let nr01 = findStr(body, "nr01");
  let voucherNo = findStr(body, "p01");
  if (!nr01 && fields.p125) {
    // Fallback: look it up by our order number
    const found = await findGtVoucherByOrder(fields.p125);
    nr01 = found?.nr01;
    voucherNo ??= found?.voucherNo;
  }
  if (!nr01) throw new GtError("Το voucher δημιουργήθηκε αλλά το GT δεν επέστρεψε κωδικό (nr01)", 500, body);
  if (!voucherNo) voucherNo = (await getGtVoucher(nr01))?.voucherNo;
  return { nr01, voucherNo: voucherNo ?? nr01, raw: body };
}

export async function getGtVoucher(nr01: string) {
  const { status, body } = await gtRequest(`/courier/r18/${encodeURIComponent(nr01)}`);
  if (status === 290) return null;
  return { nr01, voucherNo: findStr(body, "p01"), status: findStr(body, "p014"), raw: body };
}

/** Guards against duplicates: is there already a GT voucher with this order number (p125)? (GT keeps ~1 month in GET.) */
export async function findGtVoucherByOrder(orderName: string) {
  const { status, body } = await gtRequest("/courier/r18", {
    query: { "filter[and][0][p125][equals]": orderName, recperpage: 1 },
  });
  if (status === 290) return null;
  const nr01 = findStr(body, "nr01");
  return nr01 ? { nr01, voucherNo: findStr(body, "p01") } : null;
}

/** Latest real vouchers — shown on /settings/debug to confirm the field mapping. */
export async function sampleGtVouchers(n = 3) {
  const { body } = await gtRequest("/courier/r18/all", {
    query: { recperpage: n, "order_array[nr01]": "DESC" },
  });
  return body;
}

export async function listGtStatuses() {
  const { body } = await gtRequest("/courier/r14");
  return body;
}

/** PUT r18/{nr01} with a new status code (e.g. cancellation "AKY"). */
export async function setGtVoucherStatus(nr01: string, statusCode: string) {
  await gtRequest(`/courier/r18/${encodeURIComponent(nr01)}`, { method: "PUT", form: { p014: statusCode } });
}

/** GET /courier/voucher_tracking → current status + history for voucher numbers. */
export async function trackGtVouchers(voucherNos: string[]) {
  const query: Record<string, string> = {};
  voucherNos.forEach((v, i) => (query[`vouchercode[${i}]`] = v));
  const { body } = await gtRequest("/courier/voucher_tracking", { query });
  return body;
}

/** Current GT status code of one voucher (e.g. "ΕΚΡ", "AKY"), or null when GT no longer knows the voucher. */
export async function gtVoucherStatus(voucherNo: string): Promise<string | null> {
  const body = (await trackGtVouchers([voucherNo])) as { data?: { r18p01?: string; r18p014?: string }[] } | null;
  const row = (Array.isArray(body?.data) ? body!.data : []).find((r) => r.r18p01 === voucherNo);
  return row?.r18p014 ? String(row.r18p014).replace(/\\/g, "") : null;
}
