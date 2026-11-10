import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { n: number; until: number }>();

async function login(formData: FormData) {
  "use server";
  const key = "admin";
  const a = attempts.get(key);
  if (a && a.until > Date.now()) redirect("/login?e=locked");

  const ok = await bcrypt.compare(String(formData.get("password") ?? ""), env.adminPasswordHash());
  if (!ok) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    redirect("/login?e=1");
  }
  attempts.delete(key);
  const s = await getSession();
  s.loggedIn = true;
  await s.save();
  redirect("/orders");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm animate-fade">
        <div className="mb-10 flex flex-col items-center gap-3">
          <Logo className="h-14" />
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-soft">Αποστολές ✦ GT Courier</p>
        </div>
        <form action={login} className="rounded-2xl border border-sand bg-white/60 p-6 shadow-[0_1px_0_rgba(42,26,18,0.04)]">
          <label className="label" htmlFor="password">Κωδικός διαχειριστή</label>
          <input id="password" name="password" type="password" autoFocus required className="field" autoComplete="current-password" />
          {e && (
            <p className="mt-3 text-sm text-wine">
              {e === "locked" ? "Πολλές αποτυχημένες προσπάθειες. Δοκιμάστε σε 5 λεπτά." : "Λάθος κωδικός."}
            </p>
          )}
          <button className="mt-5 w-full rounded-xl bg-burgundy py-2.5 text-sm font-semibold text-cream transition hover:bg-burgundy-hover">
            Είσοδος
          </button>
        </form>
      </div>
    </main>
  );
}
