import { NextResponse } from "next/server";
import { resolveArea, isGenericArea } from "@/lib/gt/areas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GT service areas for a postcode, plus the one we would pick for the city. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const zip = (u.searchParams.get("zip") ?? "").replace(/\s/g, "");
  const city = u.searchParams.get("city") ?? "";
  const country = (u.searchParams.get("country") || "GR").toUpperCase();
  if (!zip) return NextResponse.json({ error: "zip required" }, { status: 400 });
  try {
    const { options, picked } = await resolveArea(zip, city, country);
    // Specific areas first (alphabetical), catch-all ones ("ΧΕΡΣΑΙΟΙ ΠΡΟΟΡΙΣΜΟΙ"…) last
    const sorted = options
      .map((o) => ({ ...o, generic: isGenericArea(o) }))
      .sort((a, b) => Number(a.generic) - Number(b.generic) || a.name.localeCompare(b.name, "el"));
    return NextResponse.json({ options: sorted, suggested: picked?.code ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
