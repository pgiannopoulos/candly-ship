"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

export function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch("/api/sync", { method: "POST" });
          const d = await r.json();
          setMsg(r.ok ? `${d.count} παραγγελίες${d.webhooks?.length ? " · webhooks ✓" : ""}` : d.error);
          setBusy(false);
          router.refresh();
        }}
      >
        Συγχρονισμός τώρα
      </Button>
      {msg && <span className="text-xs text-ink-soft">{msg}</span>}
    </div>
  );
}
