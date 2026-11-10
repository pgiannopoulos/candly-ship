import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { GtResult, ReqOpts } from "./client";

/**
 * Fake Pegasus backend (GT_MOCK=1) so the whole flow can be developed and demoed
 * before GT Courier provides the appcode / codes. Never used in production.
 */
const store = new Map<string, Record<string, string>>();
let seq = 9000;

const json = (status: number, body: unknown): GtResult => ({
  status,
  body,
  res: new Response(JSON.stringify(body), { status: status === 290 ? 200 : status }),
});

export async function mockGt(path: string, opts: ReqOpts): Promise<GtResult> {
  await new Promise((r) => setTimeout(r, 250));

  if (path === "/api/courier00/r18" && opts.form) {
    if (opts.form.p0201?.toUpperCase().includes("FAIL")) {
      return Promise.reject(Object.assign(new Error("Mock GT: Η αποθήκευση απέτυχε — μη έγκυρος ΤΚ"), { status: 403 }));
    }
    const nr01 = String(++seq);
    const p01 = `GT${new Date().getFullYear()}${nr01.padStart(8, "0")}`;
    store.set(nr01, { ...opts.form, nr01, p01 });
    return json(201, { code: 201, data: { nr01, p01 } });
  }

  if (path === "/api/courier00/r18" && opts.query) {
    const order = String(opts.query["filter[and][0][p125][equals]"] ?? "");
    const hit = [...store.values()].find((v) => v.p125 === order);
    return hit ? json(200, { data: [hit] }) : json(290, []);
  }

  if (path.startsWith("/api/courier00/r18/all")) return json(200, { data: [...store.values()].slice(-3) });

  const one = path.match(/^\/api\/courier00\/r18\/(\d+)$/);
  if (one) {
    const v = store.get(one[1]);
    if (opts.method === "PUT" && v) Object.assign(v, opts.form);
    return v ? json(200, { data: v }) : json(290, []);
  }

  if (path === "/api/courier00/r14")
    return json(200, { data: [{ p01: "01", p02: "Καταχώρηση" }, { p01: "99", p02: "Ακύρωση" }] });

  if (path === "/api/prints/print") {
    const v = store.get(opts.form?.tbl_nr01 ?? "") ?? { p01: "GT-MOCK", p0201: "Mock", p0202: "", p0203: "", p0208_1: "" };
    const pdf = await mockLabel(v);
    return { status: 200, body: null, res: new Response(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf" } }) };
  }

  return json(400, { code: 400, data: { error: { title: "Mock", detail: `Unknown path ${path}` } } });
}

/** 100×150 mm label. Standard PDF fonts are Latin-only, so Greek is transliterated (mock only). */
async function mockLabel(v: Record<string, string>) {
  const tr = (s = "") =>
    s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\x20-\x7E]/g, (c) => GREEK[c.toLowerCase()] ?? "?");
  const doc = await PDFDocument.create();
  const page = doc.addPage([283.46, 425.2]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.17, 0.08, 0.1);
  page.drawText("GT COURIER  ·  MOCK LABEL", { x: 16, y: 400, size: 9, font: bold, color: ink });
  page.drawText(tr(v.p01), { x: 16, y: 360, size: 22, font: bold, color: ink });
  // fake barcode
  let x = 16;
  for (const ch of v.p01 ?? "") {
    const w = (ch.charCodeAt(0) % 3) + 1;
    page.drawRectangle({ x, y: 300, width: w, height: 48, color: ink });
    x += w + 2;
  }
  const lines = [
    ["TO", tr(v.p0201)],
    ["", tr(v.p0202)],
    ["", `${tr(v.p0208_1)} ${tr(v.p0203)}`],
    ["TEL", tr(v.p0206)],
    ["ORDER", tr(v.p125)],
    ["PIECES", `${v.p120 ?? 1}   WEIGHT ${v.p101 ?? ""} kg`],
    ["COD", v.p026 === "1" ? `${v.p022} EUR` : "-"],
  ];
  let y = 270;
  for (const [k, val] of lines) {
    if (k) page.drawText(k, { x: 16, y, size: 7, font: bold, color: ink });
    page.drawText(val.slice(0, 40), { x: 62, y, size: 10, font: reg, color: ink });
    y -= 20;
  }
  return doc.save();
}

const GREEK: Record<string, string> = {
  α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m", ν: "n",
  ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
};
