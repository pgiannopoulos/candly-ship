import { NextResponse } from "next/server";
import { listOrders, type Tab } from "@/lib/orderDto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const tab = (["new", "voucher", "all"].includes(u.searchParams.get("tab") ?? "") ? u.searchParams.get("tab") : "new") as Tab;
  const q = (u.searchParams.get("q") ?? "").trim();
  return NextResponse.json(await listOrders(tab, q));
}
