import type { GtResult, ReqOpts } from "./client";

/**
 * Fake GT Hermes backend (GT_MOCK=1) so the whole flow can be developed and demoed
 * without touching GT. Never used in production.
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

  if (path === "/courier/make_zonearea") {
    const zip = String(opts.query?.r21p02 ?? "");
    const city = zip.startsWith("54") || zip.startsWith("55") ? "ΘΕΣΣΑΛΟΝΙΚΗ" : zip.startsWith("1") ? "ΑΘΗΝΑ" : "ΠΕΡΙΦΕΡΕΙΑ";
    const data = [
      { d23p01: "GR", r21p02: zip, r07p02: "ΧΕΡΣΑΙΟΙ ΠΡΟΟΡΙΣΜΟΙ", r02p01: "003", r07p01: "2" },
      { d23p01: "GR", r21p02: zip, r07p02: city, r02p01: "003", r07p01: `1${zip}` },
    ];
    if (zip.startsWith("116")) data.push({ d23p01: "GR", r21p02: zip, r07p02: "ΠΑΓΚΡΑΤΙ", r02p01: "003", r07p01: "20919" });
    return json(200, { code: 200, data });
  }

  if (path === "/courier/r18" && opts.form) {
    if (opts.form.p0201?.toUpperCase().includes("FAIL")) {
      return Promise.reject(Object.assign(new Error("Mock GT: Αποτυχία υπολογισμού κόστους — μη έγκυρη περιοχή"), { status: 400 }));
    }
    const nr01 = String(++seq);
    const p01 = `V-${nr01.padStart(8, "3")}`;
    store.set(nr01, { ...opts.form, nr01, p01 });
    return json(201, { code: 201, data: { nr01, p01 } });
  }

  if (path === "/courier/r18" && opts.query) {
    const order = String(opts.query["filter[and][0][p125][equals]"] ?? "");
    const hit = [...store.values()].find((v) => v.p125 === order);
    return hit ? json(200, { data: [hit] }) : json(290, []);
  }

  if (path.startsWith("/courier/r18/all")) return json(200, { data: [...store.values()].slice(-3) });

  const one = path.match(/^\/courier\/r18\/(\d+)$/);
  if (one) {
    const v = store.get(one[1]);
    if (opts.method === "PUT" && v) Object.assign(v, opts.form);
    return v ? json(200, { data: v }) : json(401, { code: 401, data: { error: { title: "Mock", detail: "Voucher not found" } } });
  }

  if (path === "/courier/voucher_tracking") {
    const no = String(opts.query?.["vouchercode[0]"] ?? "");
    const v = [...store.values()].find((x) => x.p01 === no);
    return json(200, { code: 200, data: v ? [{ r18p01: v.p01, r18p014: v.p014 ?? "ΕΚΡ", r14p02: "", r15r14r25: [] }] : [] });
  }

  if (path === "/courier/r14")
    return json(200, { data: [{ nr01: "1", p01: "ΕΚΡ", p02: "Εκκρεμεί (προς Παραλλαβή)" }, { nr01: "4", p01: "AKY", p02: "Ακύρωση Εργασίας" }] });

  return json(400, { code: 400, data: { error: { title: "Mock", detail: `Unknown path ${path}` } } });
}
