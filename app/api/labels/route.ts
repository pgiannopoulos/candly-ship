import { NextResponse } from "next/server";
import { labelsForOrders } from "@/lib/vouchers";

export const runtime = "nodejs";
export const maxDuration = 300;

/** GET /api/labels?ids=a,b,c → one PDF (10×15 labels, one page per package) shown inline for printing. */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 100);
  if (!ids.length) return NextResponse.json({ error: "ids required" }, { status: 400 });
  try {
    const { pdf } = await labelsForOrders(ids);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="candly-labels-${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new NextResponse(errorPage(msg), { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

const errorPage = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Σφάλμα εκτύπωσης</title>
<body style="font-family:system-ui;background:#fffaf6;color:#2b1519;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:420px;text-align:center"><p style="font-size:28px;margin:0">✦</p>
<h1 style="font-size:18px">Δεν ήταν δυνατή η εκτύπωση</h1><p style="color:#8c1d2a">${msg.replace(/</g, "&lt;")}</p>
<p style="font-size:13px;opacity:.7">Ελέγξτε τον Πίνακα Δεδομένων (tbl) και τη Φόρμα (p85) στις Ρυθμίσεις.</p></div></body>`;
