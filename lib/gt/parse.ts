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

/** First object-valued property with this name, at any depth. */
function findKeyObj(obj: unknown, name: string, depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const r = findKeyObj(x, name, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const rec = obj as Record<string, unknown>;
  if (rec[name] && typeof rec[name] === "object") return rec[name];
  for (const v of Object.values(rec)) {
    const r = findKeyObj(v, name, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

export const findStr =(obj: unknown, ...names: string[]): string | undefined => {
  const lower = names.map((n) => n.toLowerCase());
  const v = findKey(obj, (k) => lower.includes(k.toLowerCase()));
  return v === undefined ? undefined : String(v);
};

/** Hermes error body: {"code": 400, "data": {"error": {"title","detail"}}} — login errors wrap it in an array. */
export function pegasusErrorMessage(body: unknown, status: number): string {
  const errObj = findKeyObj(body, "error") as { title?: string; detail?: string } | undefined;
  const title = errObj?.title;
  const detail = errObj?.detail;
  const known: Record<number, string> = {
    400: "Μη έγκυρα στοιχεία ή αποτυχία υπολογισμού κόστους",
    401: "Μη έγκυρη σύνδεση ή χωρίς δικαίωμα",
    403: "Η αποθήκευση απέτυχε",
    404: "Η εγγραφή δεν βρέθηκε",
    405: "Μη υποστηριζόμενη μέθοδος",
    500: "Σφάλμα διακομιστή GT",
  };
  return [title, detail].filter(Boolean).join(" — ") || known[status] || `HTTP ${status}`;
}
