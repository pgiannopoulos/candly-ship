import { describe, expect, it } from "vitest";
import { mapVoucher, VoucherValidationError, type VoucherInput } from "@/lib/gt/mapVoucher";
import { pickArea, normPlace, type GtArea } from "@/lib/gt/areas";
import { SETTING_DEFAULTS, type Settings } from "@/lib/settings";

const settings: Settings = { ...SETTING_DEFAULTS, gtWorkType: "001" };

const base: VoucherInput = {
  orderName: "#1042",
  email: "maria@example.com",
  address: {
    name: "Μαρία Παπαδοπούλου",
    address1: "Λεωφ. Κηφισίας 100",
    address2: "3ος όροφος",
    city: "Μαρούσι",
    zip: "151 24",
    countryCode: "GR",
    phone: "+30 694 123 4567",
  },
  lineItems: [{ name: "Melomakarono Candle", quantity: 2 }],
  pieces: 1,
  weightKg: 0.8,
  codAmount: 0,
  recipientArea: { code: "11214", zone: "003" },
};

describe("mapVoucher (Hermes)", () => {
  it("maps a prepaid order", () => {
    const f = mapVoucher(base, settings);
    expect(f).toMatchObject({
      p126: "2",
      p125: "#1042",
      p120: "1",
      p101: "0.8",
      p04: "001",
      p0201: "Μαρία Παπαδοπούλου",
      p0202: "Λεωφ. Κηφισίας 100, 3ος όροφος",
      p0203: "Μαρούσι",
      p0208: "15124",
      p0204country: "GR",
      p0204: "11214",
      p0205: "003",
      p0206: "6941234567",
      p0210: "maria@example.com",
    });
    expect(f.p022).toBeUndefined();
  });

  it("uses the GT account's sender when no sender address is set", () => {
    const f = mapVoucher(base, settings);
    expect(f.p0101).toBeUndefined();
    expect(f.p0104).toBeUndefined();
  });

  it("sends the sender with its own area when filled in", () => {
    const s = { ...settings, senderAddress: "Ερμού 1", senderPostcode: "105 63", senderArea: "Αθήνα", senderPhone: "+30 210 1234567" };
    const f = mapVoucher({ ...base, senderArea: { code: "11214", zone: "003" } }, s);
    expect(f).toMatchObject({ p0101: "Candly", p0102: "Ερμού 1", p0108: "10563", p0104: "11214", p0105: "003", p0106: "2101234567" });
  });

  it("maps cash on delivery", () => {
    expect(mapVoucher({ ...base, codAmount: 34.9 }, settings).p022).toBe("34.90");
  });

  it("truncates long values", () => {
    const long = "Α".repeat(200);
    const f = mapVoucher({ ...base, orderName: "#1234567890123456789", address: { ...base.address, name: long, address1: long } }, settings);
    expect(f.p0201.length).toBe(60);
    expect(f.p0202.length).toBe(100);
    expect(f.p125.length).toBe(15);
  });

  it("omits GT codes that are not configured", () => {
    const f = mapVoucher(base, { ...settings, gtWorkType: "" });
    expect(f.p04).toBeUndefined();
    expect(f.p014).toBeUndefined();
  });

  it("rejects missing phone / bad postcode / missing area", () => {
    expect(() => mapVoucher({ ...base, address: { ...base.address, phone: "" } }, settings)).toThrow(VoucherValidationError);
    expect(() => mapVoucher({ ...base, address: { ...base.address, zip: "12" } }, settings)).toThrow(/ΤΚ/);
    expect(() => mapVoucher({ ...base, recipientArea: { code: "", zone: "" } }, settings)).toThrow(/περιοχή GT/);
  });
});

// Real answers from GT's make_zonearea (DEMO account)
const GENERIC: GtArea = { code: "2", zone: "003", name: "ΧΕΡΣΑΙΟΙ ΠΡΟΟΡΙΣΜΟΙ" };
const ATHENS = [GENERIC, { code: "11214", zone: "003", name: "ΑΘΗΝΑ" }, { code: "20919", zone: "003", name: "ΠΑΓΚΡΑΤΙ" }];
const THESS = [GENERIC, { code: "15015", zone: "003", name: "ΘΕΣΣΑΛΟΝΙΚΗ" }];

describe("pickArea", () => {
  it("normalises Greek and Latin place names", () => {
    expect(normPlace("Θεσσαλονίκη")).toBe("THESSALONIKI");
    expect(normPlace("Thessaloniki")).toBe("THESSALONIKI");
    expect(normPlace("Αθήνα")).toBe(normPlace("ΑΘΗΝΑ"));
  });
  it("matches the city exactly (Greek, accents, case)", () => {
    expect(pickArea(ATHENS, "Αθήνα")?.code).toBe("11214");
    expect(pickArea(ATHENS, "Παγκράτι")?.code).toBe("20919");
  });
  it("matches a Latin city", () => {
    expect(pickArea(THESS, "Thessaloniki")?.code).toBe("15015");
  });
  it("takes the only specific area when the city does not match", () => {
    expect(pickArea(THESS, "Καλαμαριά")?.code).toBe("15015");
  });
  it("understands common English city names", () => {
    expect(pickArea(ATHENS, "Athens")?.code).toBe("11214");
  });
  it("returns null when ambiguous", () => {
    expect(pickArea(ATHENS, "Ζωγράφου")).toBeNull();
    expect(pickArea(ATHENS, "")).toBeNull();
  });
  it("never auto-picks the hard-to-reach catch-all", () => {
    const opts = [GENERIC, { code: "9", zone: "003", name: "ΔΥΣΠΡΟΣΙΤΕΣ ΠΕΡΙΟΧΕΣ" }, { code: "23088", zone: "003", name: "ΣΑΜΟΣ" }];
    expect(pickArea(opts, "Πυθαγόρειο")?.code).toBe("23088");
  });
  it("never prefers the catch-all area", () => {
    expect(pickArea(THESS, "Χερσαίοι")?.code).toBe("15015");
  });
});
