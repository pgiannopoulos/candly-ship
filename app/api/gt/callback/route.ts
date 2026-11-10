import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import { exchangeAccessCode } from "@/lib/gt/client";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

/** Step 2: Pegasus redirects back with ?access_code=…&info=<state>. Exchange it for tokens (within 5 min). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const code = u.searchParams.get("access_code");
  const info = u.searchParams.get("info");
  const session = await getSession();
  const back = (q: string) => NextResponse.redirect(`${env.appUrl()}/settings?${q}`);

  if (!code) return back("gt_error=" + encodeURIComponent("Δεν επιστράφηκε access_code"));
  if (info && session.gtState && info !== session.gtState) return back("gt_error=" + encodeURIComponent("Μη έγκυρο state"));

  try {
    await exchangeAccessCode(code);
    session.gtState = undefined;
    await session.save();
    await audit("gt.connected");
    return back("gt_connected=1");
  } catch (e) {
    return back("gt_error=" + encodeURIComponent(e instanceof Error ? e.message : String(e)));
  }
}
