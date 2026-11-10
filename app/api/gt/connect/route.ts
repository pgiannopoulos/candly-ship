import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import { initiateAuth } from "@/lib/gt/client";

export const runtime = "nodejs";

/** Step 1: ask Pegasus for a login URL and send the admin there. */
export async function GET() {
  const session = await getSession();
  const state = randomBytes(16).toString("hex");
  session.gtState = state;
  await session.save();
  try {
    const url = await initiateAuth(`${env.appUrl()}/api/gt/callback`, state);
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : String(e));
    return NextResponse.redirect(`${env.appUrl()}/settings?gt_error=${msg}`);
  }
}
