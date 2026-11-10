import { PDFDocument } from "pdf-lib";
import { gtRequest, GtError } from "./client";
import { findStr } from "./parse";

export type CreatedVoucher = { nr01: string; voucherNo: string; raw: unknown };

/** POST /api/courier00/r18 → create the voucher at GT */
export async function createGtVoucher(fields: Record<string, string>): Promise<CreatedVoucher> {
  const { body } = await gtRequest("/api/courier00/r18", { form: fields });
  let nr01 = findStr(body, "nr01", "id");
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
  const { status, body } = await gtRequest(`/api/courier00/r18/${encodeURIComponent(nr01)}`);
  if (status === 290) return null;
  return { nr01, voucherNo: findStr(body, "p01"), status: findStr(body, "p014"), raw: body };
}

/** Guards against duplicates: is there already a GT voucher with this order number (p125)? */
export async function findGtVoucherByOrder(orderName: string) {
  const { status, body } = await gtRequest("/api/courier00/r18", {
    query: { "filter[and][0][p125][equals]": orderName, recperpage: 1 },
  });
  if (status === 290) return null;
  const nr01 = findStr(body, "nr01");
  return nr01 ? { nr01, voucherNo: findStr(body, "p01") } : null;
}

/** Latest real vouchers — shown on /settings/debug to confirm the field mapping. */
export async function sampleGtVouchers(n = 3) {
  const { body } = await gtRequest("/api/courier00/r18/all", {
    query: { recperpage: n, "order_array[nr01]": "DESC" },
  });
  return body;
}

export async function listGtStatuses() {
  const { body } = await gtRequest("/api/courier00/r14");
  return body;
}

/** PUT r18/{id} with a new status code (cancellation, once GT tells us which code). */
export async function setGtVoucherStatus(nr01: string, statusCode: string) {
  await gtRequest(`/api/courier00/r18/${encodeURIComponent(nr01)}`, { method: "PUT", form: { p014: statusCode } });
}

/** POST /api/prints/print → label PDF bytes. Accepts a binary PDF, base64 in JSON, or a URL in JSON. */
export async function printGtVoucher(nr01: string, table: string, form?: string): Promise<Uint8Array> {
  if (!table) throw new GtError("Δεν έχει οριστεί ο Πίνακας Δεδομένων (tbl) εκτύπωσης στις Ρυθμίσεις", 400);
  const fields: Record<string, string> = { tbl: table, tbl_nr01: nr01 };
  if (form) fields.p85 = form;
  const { res, body } = await gtRequest("/api/prints/print", { form: fields, raw: true });

  if (body === null) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (isPdf(buf)) return buf;
    const text = new TextDecoder().decode(buf);
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return pdfFromJson(json);
  }
  return pdfFromJson(body);
}

const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

async function pdfFromJson(json: unknown): Promise<Uint8Array> {
  const candidates: string[] = [];
  const walk = (o: unknown) => {
    if (typeof o === "string") candidates.push(o);
    else if (o && typeof o === "object") Object.values(o).forEach(walk);
  };
  walk(json);
  for (const c of candidates) {
    const b64 = c.replace(/^data:application\/pdf;base64,/, "");
    if (b64.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(b64)) {
      const buf = new Uint8Array(Buffer.from(b64, "base64"));
      if (isPdf(buf)) return buf;
    }
    if (/^https?:\/\/.+/i.test(c)) {
      const r = await fetch(c);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (isPdf(buf)) return buf;
    }
  }
  throw new GtError("Το GT δεν επέστρεψε PDF ετικέτας", 500, json);
}

export async function mergePdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of pdfs) {
    const src = await PDFDocument.load(p);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  return out.save();
}
