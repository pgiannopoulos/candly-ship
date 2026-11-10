/**
 * Normalise phone numbers for GT (Greek couriers expect a 10-digit national number).
 *  "+30 694 123 4567" → "6941234567",  "0030 210 1234567" → "2101234567"
 * Foreign numbers keep their international "+" form.
 */
export function normalizePhone(raw?: string | null): string {
  if (!raw) return "";
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+30")) return s.slice(3);
  if (s.startsWith("30") && s.length === 12) return s.slice(2);
  return s;
}
