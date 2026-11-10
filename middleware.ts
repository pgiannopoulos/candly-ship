import { NextResponse, type NextRequest } from "next/server";
import { unsealData } from "iron-session";
import type { SessionData } from "@/lib/session";

const PUBLIC = [/^\/login/, /^\/api\/webhooks\//, /^\/api\/health/, /^\/brand\//, /^\/_next\//, /^\/favicon/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();

  const cookie = req.cookies.get("candly_ship")?.value;
  let ok = false;
  if (cookie) {
    try {
      const s = await unsealData<SessionData>(cookie, { password: (process.env.APP_SECRET ?? "").padEnd(32, "0") });
      ok = !!s.loggedIn;
    } catch {
      ok = false;
    }
  }
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
