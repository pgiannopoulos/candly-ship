import { db } from "../db";
import { encrypt, decrypt } from "../crypto";
import { env } from "../env";
import { findStr, pegasusErrorMessage } from "./parse";
import { mockGt } from "./mock";

export class GtError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}
export class GtNotConnectedError extends GtError {
  constructor(msg = "Δεν υπάρχει σύνδεση με GT Courier. Συνδεθείτε από τις Ρυθμίσεις.") {
    super(msg, 401);
  }
}

export type Query = Record<string, string | number | undefined>;
export type ReqOpts = { query?: Query; form?: Record<string, string>; method?: "GET" | "POST" | "PUT"; raw?: boolean };
export type GtResult = { status: number; body: unknown; res: Response };

function toForm(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function rawPost(path: string, fields: Record<string, string>) {
  const res = await fetch(`${env.gtHost()}${path}`, { method: "POST", body: toForm(fields), cache: "no-store" });
  const body = await parseBody(res);
  if (!res.ok) throw new GtError(pegasusErrorMessage(body, res.status), res.status, body);
  return body;
}

// ─── Auth (Pegasus: initiate_authentication → login → get_access_token) ──

export async function initiateAuth(redirectUrl: string, state: string): Promise<string> {
  if (env.gtMock()) return `${redirectUrl}?access_code=mock-${Date.now()}&info=${state}`;
  const body = await rawPost("/api/pegapi/initiate_authentication", {
    redirect_url: redirectUrl,
    appcode: env.gtAppcode(),
    info: state,
    description: "Candly Ship (Shopify middleware)",
    lang: "GR",
  });
  const url = findStr(body, "url", "login_url", "auth_url", "redirect");
  if (!url) throw new GtError("Το GT δεν επέστρεψε URL σύνδεσης", 500, body);
  return url;
}

export async function exchangeAccessCode(accessCode: string) {
  const body = env.gtMock()
    ? { access_token: "mock-access", refresh_token: "mock-refresh" }
    : await rawPost("/api/pegapi/get_access_token", { access_code: accessCode });
  const access = findStr(body, "access_token", "accesstoken", "token");
  const refresh = findStr(body, "refresh_token", "refreshtoken");
  if (!access || !refresh) throw new GtError("Το GT δεν επέστρεψε tokens", 500, body);
  const data = {
    accessToken: encrypt(access),
    refreshToken: encrypt(refresh),
    connectedAt: new Date(),
    refreshedAt: null,
    lastError: null,
  };
  await db.gtToken.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

async function getTokens() {
  const t = await db.gtToken.findUnique({ where: { id: 1 } });
  if (!t) throw new GtNotConnectedError();
  return { access: decrypt(t.accessToken), refresh: decrypt(t.refreshToken) };
}

let refreshing: Promise<string> | null = null;
async function refreshAccessToken(): Promise<string> {
  refreshing ??= (async () => {
    try {
      const { refresh } = await getTokens();
      const body = await rawPost("/api/pegapi/refresh_token", { refresh_token: refresh });
      const access = findStr(body, "access_token", "accesstoken", "token");
      if (!access) throw new GtError("Η ανανέωση token απέτυχε", 500, body);
      const newRefresh = findStr(body, "refresh_token");
      await db.gtToken.update({
        where: { id: 1 },
        data: {
          accessToken: encrypt(access),
          ...(newRefresh ? { refreshToken: encrypt(newRefresh) } : {}),
          refreshedAt: new Date(),
          lastError: null,
        },
      });
      return access;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.gtToken.update({ where: { id: 1 }, data: { lastError: msg } }).catch(() => {});
      throw new GtNotConnectedError(`Η σύνδεση με GT έληξε (${msg}). Συνδεθείτε ξανά από τις Ρυθμίσεις.`);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// ─── Authenticated requests ─────────────────────────────────────────────

async function gtFetch(path: string, opts: ReqOpts, token: string) {
  const url = new URL(`${env.gtHost()}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const method = opts.method ?? (opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: BodyInit | undefined;
  if (opts.form && method === "PUT") {
    // Pegasus: PUT uses x-www-form-urlencoded
    body = new URLSearchParams(opts.form);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (opts.form) {
    // Pegasus: POST uses form-data
    body = toForm(opts.form);
  }
  return fetch(url, { method, headers, body, cache: "no-store" });
}

/** Calls Pegasus with the stored token; on 419 refreshes once and retries. */
export async function gtRequest(path: string, opts: ReqOpts = {}): Promise<GtResult> {
  if (env.gtMock()) return mockGt(path, opts);
  let { access } = await getTokens();
  let res = await gtFetch(path, opts, access);
  if (res.status === 419) {
    access = await refreshAccessToken();
    res = await gtFetch(path, opts, access);
  }
  if (res.status === 290) return { status: 290, body: [], res }; // "no records"
  if (opts.raw && res.ok) return { status: res.status, body: null, res };
  const body = await parseBody(res);
  if (!res.ok) throw new GtError(pegasusErrorMessage(body, res.status), res.status, body);
  return { status: res.status, body, res };
}

export async function gtConnectionStatus() {
  const t = await db.gtToken.findUnique({ where: { id: 1 } });
  return {
    connected: !!t && !t.lastError,
    connectedAt: t?.connectedAt ?? null,
    refreshedAt: t?.refreshedAt ?? null,
    lastError: t?.lastError ?? null,
  };
}
