import { db } from "../db";
import { encrypt, decrypt } from "../crypto";
import { env } from "../env";
import { findStr, pegasusErrorMessage } from "./parse";
import { mockGt } from "./mock";

/**
 * GT Courier — Pegasus "Hermes" REST API (https://www.tesae.gr/pegasus-hermes-rest-api).
 * Login with username/password → session id (sid), sent as `sid` on every request
 * (query string for GET, form field for POST/PUT). An expired session answers 401 → we log in again once.
 */

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

const api = (path: string) => `${env.gtHost()}/hermes_api${path}`;

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ─── Session ────────────────────────────────────────────────────────────

/** POST /kernel/login → sid. Throws GtError with GT's message on wrong credentials. */
export async function hermesLogin(username: string, password: string): Promise<string> {
  if (env.gtMock()) {
    if (password.toUpperCase().includes("FAIL")) throw new GtError("Mock: Λάθος όνομα χρήστη ή κωδικός", 401);
    return `mock-sid-${Date.now()}`;
  }
  const fd = new FormData();
  fd.append("username", username);
  fd.append("password", password);
  fd.append("type", "json");
  fd.append("lang", "GR");
  const res = await fetch(api("/kernel/login"), { method: "POST", body: fd, cache: "no-store" });
  const body = await parseBody(res);
  const code = Number(findStr(body, "code") ?? res.status);
  const sid = findStr(body, "sid");
  if (!res.ok || code >= 400 || !sid) throw new GtError(pegasusErrorMessage(body, code || res.status), code || res.status, body);
  return sid;
}

/** Settings → "Σύνδεση": verify the credentials with GT, then store them encrypted. */
export async function connectGt(username: string, password: string) {
  const sid = await hermesLogin(username, password);
  const data = {
    username,
    password: encrypt(password),
    sid: encrypt(sid),
    connectedAt: new Date(),
    loggedInAt: new Date(),
    lastError: null,
  };
  await db.gtAccount.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

export async function disconnectGt() {
  const a = await db.gtAccount.findUnique({ where: { id: 1 } });
  if (a?.sid && !env.gtMock()) {
    const fd = new FormData();
    fd.append("sid", decrypt(a.sid));
    await fetch(api("/kernel/logout"), { method: "POST", body: fd, cache: "no-store" }).catch(() => {});
  }
  await db.gtAccount.deleteMany();
}

let loggingIn: Promise<string> | null = null;

/** Returns a session id: the stored one, or a fresh login with the stored credentials (force = always log in). */
async function getSid(force = false): Promise<string> {
  const a = await db.gtAccount.findUnique({ where: { id: 1 } });
  if (!a) throw new GtNotConnectedError();
  if (!force && a.sid) return decrypt(a.sid);
  loggingIn ??= (async () => {
    try {
      const sid = await hermesLogin(a.username, decrypt(a.password));
      await db.gtAccount.update({ where: { id: 1 }, data: { sid: encrypt(sid), loggedInAt: new Date(), lastError: null } });
      return sid;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.gtAccount.update({ where: { id: 1 }, data: { sid: null, lastError: msg } }).catch(() => {});
      throw new GtNotConnectedError(`Η σύνδεση με GT απέτυχε (${msg}). Ελέγξτε τα στοιχεία στις Ρυθμίσεις.`);
    } finally {
      loggingIn = null;
    }
  })();
  return loggingIn;
}

// ─── Requests ───────────────────────────────────────────────────────────

function send(path: string, opts: ReqOpts, sid: string) {
  const url = new URL(api(path));
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  const method = opts.method ?? (opts.form ? "POST" : "GET");
  let body: BodyInit | undefined;
  const headers: Record<string, string> = { Accept: "application/json, application/pdf" };
  if (method === "GET") {
    url.searchParams.set("sid", sid);
  } else if (method === "PUT") {
    // Hermes: PUT uses x-www-form-urlencoded
    body = new URLSearchParams({ ...(opts.form ?? {}), sid });
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    url.searchParams.set("sid", sid);
  } else {
    // Hermes: POST uses multipart/form-data
    const fd = new FormData();
    for (const [k, v] of Object.entries(opts.form ?? {})) fd.append(k, v);
    fd.append("sid", sid);
    body = fd;
  }
  return fetch(url, { method, headers, body, cache: "no-store" });
}

type Attempt = { res: Response; body: unknown; code: number };

async function attempt(path: string, opts: ReqOpts, sid: string): Promise<Attempt> {
  const res = await send(path, opts, sid);
  // Binary answer (label PDF): hand back the untouched response
  if (opts.raw && res.ok && /pdf|octet-stream/i.test(res.headers.get("content-type") ?? "")) return { res, body: null, code: res.status };
  const body = await parseBody(res);
  // Hermes repeats the status in the body; trust whichever reports a problem
  const bodyCode = Number((body as { code?: unknown } | null)?.code);
  const code = res.ok && Number.isFinite(bodyCode) && bodyCode > 0 ? bodyCode : res.status;
  return { res, body, code };
}

/** Calls Hermes with the stored session; on 401 logs in again once and retries. */
export async function gtRequest(path: string, opts: ReqOpts = {}): Promise<GtResult> {
  if (env.gtMock()) return mockGt(path, opts);
  let r = await attempt(path, opts, await getSid());
  if (r.code === 401) r = await attempt(path, opts, await getSid(true));
  if (r.code === 290) return { status: 290, body: [], res: r.res }; // "no records"
  if (r.body === null) return { status: r.code, body: null, res: r.res };
  if (r.code >= 400) throw new GtError(pegasusErrorMessage(r.body, r.code), r.code, r.body);
  return { status: r.code, body: r.body, res: r.res };
}

export async function gtConnectionStatus() {
  const a = await db.gtAccount.findUnique({ where: { id: 1 } });
  return {
    connected: !!a && !a.lastError,
    username: a?.username ?? null,
    connectedAt: a?.connectedAt ?? null,
    loggedInAt: a?.loggedInAt ?? null,
    lastError: a?.lastError ?? null,
  };
}
