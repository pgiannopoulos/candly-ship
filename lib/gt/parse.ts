/** Pegasus responses are not fully documented → find values defensively. */
export function findKey(obj: unknown, pred: (k: string) => boolean, depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const r = findKey(x, pred, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (pred(k) && v !== null && v !== undefined && typeof v !== "object") return v;
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = findKey(v, pred, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

export const findStr = (obj: unknown, ...names: string[]): string | undefined => {
  const lower = names.map((n) => n.toLowerCase());
  const v = findKey(obj, (k) => lower.includes(k.toLowerCase()));
  return v === undefined ? undefined : String(v);
};

/** Pegasus error body: {"code": "...", "data": {"error": {"title": "...", "detail": "..."}}} */
export function pegasusErrorMessage(body: unknown, status: number): string {
  const b = body as { data?: { error?: { title?: string; detail?: string } } } | undefined;
  const title = b?.data?.error?.title;
  const detail = b?.data?.error?.detail;
  const known: Record<number, string> = {
    400: "Μη έγκυρο αίτημα ή χωρίς δικαίωμα για αυτό το AppID",
    401: "Μη έγκυρο token ή ο χρήστης δεν έχει δικαίωμα",
    403: "Η αποθήκευση απέτυχε",
    404: "Η εγγραφή δεν βρέθηκε",
    419: "Το token έληξε",
    500: "Σφάλμα διακομιστή GT",
  };
  return [title, detail].filter(Boolean).join(" — ") || known[status] || `HTTP ${status}`;
}
