import { gtRequest, GtError } from "./client";

/**
 * Hermes service areas: one postcode can map to several areas (make_zonearea).
 * r07p01 = service-area code (→ p0204 / p0104), r02p01 = zone code (→ p0205 / p0105), r07p02 = description.
 */
export type GtArea = { code: string; zone: string; name: string };

export async function fetchAreas(zip: string, country = "GR"): Promise<GtArea[]> {
  let res;
  try {
    res = await gtRequest("/courier/make_zonearea", { query: { d23p01: country, r21p02: zip.replace(/\s/g, "") } });
  } catch (e) {
    // Unknown postcode → GT answers 400 "Δεν βρέθηκε κάποια περιοχή κάτω από το Τ.Κ."
    if (e instanceof GtError && e.status === 400) return [];
    throw e;
  }
  const { status, body } = res;
  if (status === 290) return [];
  const rows = ((body as { data?: unknown })?.data ?? []) as Record<string, unknown>[];
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ code: String(r.r07p01 ?? ""), zone: String(r.r02p01 ?? ""), name: String(r.r07p02 ?? "").replace(/\\/g, "").trim() }))
    .filter((a) => a.code);
}

/** Uppercase, no accents, Greek → Latin, letters/digits only: "Θεσσαλονίκη" and "Thessaloniki" → "THESSALONIKI". */
export function normPlace(s: string): string {
  const up = s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleUpperCase("el-GR");
  return up.replace(/[Α-Ω]/g, (c) => GR2LAT[c] ?? c).replace(/[^A-Z0-9]/g, "");
}
const GR2LAT: Record<string, string> = {
  Α: "A", Β: "V", Γ: "G", Δ: "D", Ε: "E", Ζ: "Z", Η: "I", Θ: "TH", Ι: "I", Κ: "K", Λ: "L", Μ: "M", Ν: "N",
  Ξ: "X", Ο: "O", Π: "P", Ρ: "R", Σ: "S", Τ: "T", Υ: "Y", Φ: "F", Χ: "CH", Ψ: "PS", Ω: "O",
};

/** Catch-all areas such as "ΧΕΡΣΑΙΟΙ ΠΡΟΟΡΙΣΜΟΙ" / "ΔΥΣΠΡΟΣΙΤΕΣ ΠΕΡΙΟΧΕΣ" that appear for many postcodes. */
export const isGenericArea = (a: GtArea) => /PROORISMOI|DYSPROSITESPERIOCHES/.test(normPlace(a.name));

/**
 * Picks the area for a city, or null when it is genuinely ambiguous (the admin then chooses).
 * Order: only one option → exact city match → unique partial match → the only specific (non catch-all) area.
 */
/** English names customers type in Shopify → GT's Greek name (normalised). */
const EN_ALIASES: Record<string, string> = {
  ATHENS: "ATHINA", ATHINAI: "ATHINA", PIRAEUS: "PEIRAIAS", PIREAS: "PEIRAIAS", PATRAS: "PATRA", CORFU: "KERKYRA",
  HERAKLION: "IRAKLEIO", IRAKLION: "IRAKLEIO", HERAKLIO: "IRAKLEIO", RHODES: "RODOS", SALONICA: "THESSALONIKI",
  KAVALLA: "KAVALA", CHALCIS: "CHALKIDA", KIFISSIA: "KIFISIA",
};

export function pickArea(options: GtArea[], city: string): GtArea | null {
  if (options.length === 0) return null;
  if (options.length === 1) return options[0];
  const raw = normPlace(city);
  const c = EN_ALIASES[raw] ?? raw;
  if (c) {
    const exact = options.filter((o) => normPlace(o.name) === c);
    if (exact.length === 1) return exact[0];
    const partial = options.filter((o) => !isGenericArea(o) && (normPlace(o.name).includes(c) || c.includes(normPlace(o.name))));
    if (partial.length === 1) return partial[0];
  }
  const specific = options.filter((o) => !isGenericArea(o));
  return specific.length === 1 ? specific[0] : null;
}

/** Resolve the area for a postcode + city. Cached briefly: the same postcodes repeat a lot. */
const cache = new Map<string, { at: number; options: GtArea[] }>();
export async function resolveArea(zip: string, city: string, country = "GR") {
  const key = `${country}:${zip.replace(/\s/g, "")}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > 6 * 3600e3) {
    hit = { at: Date.now(), options: await fetchAreas(zip, country) };
    cache.set(key, hit);
  }
  return { options: hit.options, picked: pickArea(hit.options, city) };
}
