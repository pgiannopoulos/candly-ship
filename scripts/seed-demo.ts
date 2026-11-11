/**
 * Local test orders (development only):
 *   npm run seed:demo              → adds TEST-1 … TEST-4 (fake customers) to the inbox
 *   npm run seed:demo -- --clean   → removes them again (with their vouchers)
 * Never run against the production database.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const now = Date.now();
const PREFIX = "gid://shopify/Order/demo-";

const demo = [
  { name: "TEST-1", who: "TEST Candly Παραλήπτης", a1: "Ερμού 10", city: "Αθήνα", zip: "105 63", phone: "6900000001", total: 25.0, cod: false, items: [["Test Candle", 1]] },
  { name: "TEST-2", who: "TEST Αντικαταβολή", a1: "Τσιμισκή 45", city: "Θεσσαλονίκη", zip: "546 23", phone: "6900000002", total: 34.9, cod: true, items: [["Test Candle", 2]] },
  { name: "TEST-3", who: "TEST Διφορούμενη Περιοχή", a1: "Παπάγου 5", city: "Ζωγράφου", zip: "116 33", phone: "6900000003", total: 18.0, cod: false, items: [["Mini Candle", 1]] },
  { name: "TEST-4", who: "FAIL Test Πελάτης", a1: "Αγίου Νικολάου 8", city: "Λάρισα", zip: "412 22", phone: "6900000004", total: 18.0, cod: true, items: [["Mini Candle", 3]] },
] as const;

async function main() {
  if (process.argv.includes("--clean")) {
    const r = await db.order.deleteMany({ where: { shopifyId: { startsWith: PREFIX } } });
    console.log(`Removed ${r.count} test orders`);
    return;
  }
  for (const [i, d] of demo.entries()) {
    const created = new Date(now - (demo.length - i) * 7 * 60_000);
    const lineItems = d.items.map(([name, quantity]) => ({ name, quantity }));
    await db.order.upsert({
      where: { shopifyId: `${PREFIX}${d.name}` },
      update: {},
      create: {
        shopifyId: `${PREFIX}${d.name}`,
        name: d.name,
        shopifyCreatedAt: created,
        shopifyUpdatedAt: created,
        email: `${d.name.toLowerCase()}@example.com`,
        totalPrice: new Prisma.Decimal(d.total),
        isCod: d.cod,
        codAmount: new Prisma.Decimal(d.cod ? d.total : 0),
        totalWeightGrams: 450 * lineItems.reduce((n, l) => n + l.quantity, 0),
        itemCount: lineItems.reduce((n, l) => n + l.quantity, 0),
        shippingTitle: "GT Courier",
        financialStatus: d.cod ? "PENDING" : "PAID",
        fulfillmentStatus: "UNFULFILLED",
        shippingAddress: { name: d.who, address1: d.a1, city: d.city, zip: d.zip, countryCode: "GR", country: "Greece", phone: d.phone },
        lineItems,
      },
    });
  }
  console.log(`Seeded ${demo.length} test orders (TEST-1 … TEST-${demo.length})`);
}

main().finally(() => db.$disconnect());
