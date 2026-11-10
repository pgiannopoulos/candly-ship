import { shopifyGql } from "./client";
import type { LineItem, ShipAddress } from "../types";

const ORDER_FIELDS = /* GraphQL */ `
  id
  name
  createdAt
  updatedAt
  cancelledAt
  email
  phone
  note
  requiresShipping
  displayFinancialStatus
  displayFulfillmentStatus
  paymentGatewayNames
  totalWeight
  totalPriceSet { shopMoney { amount currencyCode } }
  totalOutstandingSet { shopMoney { amount } }
  shippingLine { title }
  shippingAddress {
    name firstName lastName company address1 address2 city province zip country countryCodeV2 phone
  }
  lineItems(first: 100) { nodes { name quantity sku requiresShipping } }
`;

export type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  requiresShipping: boolean;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  paymentGatewayNames: string[];
  totalWeight: number | string | null;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalOutstandingSet: { shopMoney: { amount: string } };
  shippingLine: { title: string } | null;
  shippingAddress: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
    countryCodeV2: string | null;
    phone: string | null;
  } | null;
  lineItems: { nodes: { name: string; quantity: number; sku: string | null; requiresShipping: boolean }[] };
};

export async function fetchOrder(gid: string): Promise<ShopifyOrder | null> {
  const d = await shopifyGql<{ order: ShopifyOrder | null }>(`query($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`, { id: gid });
  return d.order;
}

/** Orders updated since `since` (ISO). Paginates. */
export async function fetchOrdersUpdatedSince(since: string): Promise<ShopifyOrder[]> {
  const out: ShopifyOrder[] = [];
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const d: { orders: { nodes: ShopifyOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await shopifyGql(
        `query($q: String!, $after: String) {
          orders(first: 50, after: $after, query: $q, sortKey: UPDATED_AT) {
            nodes { ${ORDER_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { q: `updated_at:>'${since}'`, after },
      );
    out.push(...d.orders.nodes);
    if (!d.orders.pageInfo.hasNextPage) break;
    after = d.orders.pageInfo.endCursor;
  }
  return out;
}

export function toShipAddress(o: ShopifyOrder): ShipAddress | null {
  const a = o.shippingAddress;
  if (!a) return null;
  return {
    name: a.name || [a.firstName, a.lastName].filter(Boolean).join(" "),
    company: a.company,
    address1: a.address1 ?? "",
    address2: a.address2,
    city: a.city ?? "",
    province: a.province,
    zip: a.zip ?? "",
    country: a.country,
    countryCode: a.countryCodeV2,
    phone: a.phone || o.phone,
  };
}

export function toLineItems(o: ShopifyOrder): LineItem[] {
  return o.lineItems.nodes
    .filter((l) => l.requiresShipping !== false)
    .map((l) => ({ name: l.name, quantity: l.quantity, sku: l.sku }));
}

export async function registerWebhooks(callbackUrl: string) {
  const topics = ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_CANCELLED"];
  const existing = await shopifyGql<{
    webhookSubscriptions: { nodes: { id: string; topic: string; endpoint: { callbackUrl?: string } | null }[] };
  }>(`{ webhookSubscriptions(first: 50) { nodes { id topic endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }`);
  const results: string[] = [];
  for (const topic of topics) {
    const has = existing.webhookSubscriptions.nodes.some((w) => w.topic === topic && w.endpoint?.callbackUrl === callbackUrl);
    if (has) {
      results.push(`${topic}: ok`);
      continue;
    }
    const r = await shopifyGql<{ webhookSubscriptionCreate: { userErrors: { message: string }[] } }>(
      `mutation($topic: WebhookSubscriptionTopic!, $url: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $url, format: JSON }) {
          userErrors { message }
        }
      }`,
      { topic, url: callbackUrl },
    );
    const err = r.webhookSubscriptionCreate.userErrors.map((e) => e.message).join("; ");
    results.push(`${topic}: ${err || "created"}`);
  }
  return results;
}
