/**
 * Local demo data (development only): `npx tsx scripts/seed-demo.ts`
 * Creates a handful of realistic orders so the UI can be tried without Shopify.
 */
import { PrismaClient, Prisma } from "@prisma/client";

const db = new PrismaClient();
const now = Date.now();

const demo = [
  { name: "#1051", who: "Μαρία Παπαδοπούλου", a1: "Λεωφ. Κηφισίας 100", city: "Μαρούσι", zip: "151 24", phone: "+30 694 123 4567", total: 34.9, cod: true, items: [["Melomakarono Soy Candle", 2]] },
  { name: "#1052", who: "Γιώργος Νικολάου", a1: "Τσιμισκή 45", city: "Θεσσαλονίκη", zip: "546 23", phone: "6971112233", total: 58.0, cod: false, items: [["Kourabies Candle", 1], ["Gift Box", 1]] },
  { name: "#1053", who: "Ελένη Κωστοπούλου", a1: "Ερμού 12", city: "Πάτρα", zip: "262 21", phone: "+30 698 765 4321", total: 22.5, cod: true, items: [["Vanilla Latte Candle", 1]] },
  { name: "#1054", who: "Νίκος Δημητρίου", a1: "Πλατεία Ελευθερίας 3", city: "Ηράκλειο", zip: "712 01", phone: "6944556677", total: 79.9, cod: false, items: [["Christmas Collection Set", 1]] },
  { name: "#1055", who: "FAIL Test Πελάτης", a1: "Αγίου Νικολάου 8", city: "Λάρισα", zip: "412 22", phone: "6900000000", total: 18.0, cod: true, items: [["Mini Candle", 3]] },
] as const;

async function main() {
  for (const [i, d] of demo.entries()) {
    const created = new Date(now - (demo.length - i) * 37 * 60_000);
    const lineItems = d.items.map(([name, quantity]) => ({ name, quantity }));
    await db.order.upsert({
      where: { shopifyId: `gid://shopify/Order/demo-${d.name.slice(1)}` },
      update: {},
      create: {
        shopifyId: `gid://shopify/Order/demo-${d.name.slice(1)}`,
        name: d.name,
        shopifyCreatedAt: created,
        shopifyUpdatedAt: created,
        email: `${d.name.slice(1)}@example.com`,
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
  console.log(`Seeded ${demo.length} demo orders`);
}

main().finally(() => db.$disconnect());
