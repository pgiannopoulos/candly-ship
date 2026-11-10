import { describe, expect, it } from "vitest";
import { mapVoucher, VoucherValidationError, type VoucherInput } from "@/lib/gt/mapVoucher";
import { SETTING_DEFAULTS, type Settings } from "@/lib/settings";

const settings: Settings = {
  ...SETTING_DEFAULTS,
  gtCustomerCode: "12345",
  gtWorkType: "01",
  senderName: "Candly",
  senderAddress: "Ερμού 1",
  senderPostcode: "105 63",
  senderPhone: "+30 210 1234567",
};

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
  date: new Date(2026, 10, 10),
};

describe("mapVoucher", () => {
  it("maps a prepaid order", () => {
    const f = mapVoucher(base, settings);
    expect(f).toMatchObject({
      p015: "2026-11-10",
      p125: "#1042",
      p124: "2",
      p120: "1",
      p101: "0.800",
      p02: "12345",
      p04: "01",
      p0201: "Μαρία Παπαδοπούλου",
      p0202: "Λεωφ. Κηφισίας 100, 3ος όροφος",
      p0203: "Μαρούσι",
      p0208_1: "15124",
      p0208: "15124",
      p0206: "6941234567",
      p0210: "maria@example.com",
      p0108_1: "10563",
      p0106: "2101234567",
      p026: "0",
      pdc03: "2× Melomakarono Candle",
    });
    expect(f.p021).toBeUndefined();
  });

  it("maps cash on delivery", () => {
    const f = mapVoucher({ ...base, codAmount: 34.9 }, settings);
    expect(f.p026).toBe("1");
    expect(f.p022).toBe("34.90");
    expect(f.p021).toContain("34,90");
  });

  it("truncates to Pegasus field sizes", () => {
    const long = "Α".repeat(200);
    const f = mapVoucher({ ...base, orderName: "#1234567890123456789", address: { ...base.address, name: long, address1: long } }, settings);
    expect(f.p0201.length).toBe(60);
    expect(f.p0202.length).toBe(100);
    expect(f.p03.length).toBe(30);
    expect(f.p125.length).toBe(15);
  });

  it("omits GT codes that are not configured", () => {
    const f = mapVoucher(base, { ...settings, gtCustomerCode: "", gtWorkType: "" });
    expect(f.p02).toBeUndefined();
    expect(f.p04).toBeUndefined();
  });

  it("rejects missing phone / bad postcode", () => {
    expect(() => mapVoucher({ ...base, address: { ...base.address, phone: "" } }, settings)).toThrow(VoucherValidationError);
    expect(() => mapVoucher({ ...base, address: { ...base.address, zip: "12" } }, settings)).toThrow(/ΤΚ/);
  });
});
