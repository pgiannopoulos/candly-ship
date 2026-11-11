import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export type SessionData = { loggedIn?: boolean };

export const sessionOptions = (): SessionOptions => ({
  password: (process.env.APP_SECRET ?? "").padEnd(32, "0"),
  cookieName: "candly_ship",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14,
  },
});

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

export async function requireAuth() {
  const s = await getSession();
  if (!s.loggedIn) throw new Response("Unauthorized", { status: 401 });
  return s;
}
