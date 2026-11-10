import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { NavLinks } from "@/components/NavLinks";
import { gtConnectionStatus } from "@/lib/gt/client";

async function logout() {
  "use server";
  const s = await getSession();
  s.destroy();
  redirect("/login");
}

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const gt = await gtConnectionStatus().catch(() => ({ connected: false, lastError: null }));
  return (
    <div className="min-h-screen">
      <header className="no-print sticky top-0 z-30 border-b border-sand/70 bg-cream/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <Link href="/orders" className="flex items-center gap-3">
            <Logo className="h-8" />
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.22em] text-ink-soft sm:inline">Ship</span>
          </Link>
          <NavLinks />
          <div className="ml-auto flex items-center gap-4">
            <Link
              href="/settings"
              title={gt.connected ? "Συνδεδεμένο με GT Courier" : "Χωρίς σύνδεση με GT Courier"}
              className="flex items-center gap-2 rounded-full border border-sand px-3 py-1 text-xs font-medium text-ink-soft hover:border-sand-600"
            >
              <span className={`h-2 w-2 rounded-full ${gt.connected ? "bg-forest" : "bg-wine animate-pulse"}`} />
              GT Courier
            </Link>
            <form action={logout}>
              <button className="text-xs font-medium text-ink-soft hover:text-burgundy">Έξοδος</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
