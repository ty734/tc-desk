// Read-only Shopify Admin API lookups for the ticket order sidebar (spec §8).
// Each Inbox carries its own store domain + token, so multi-brand works with
// no code change. Tokens are stored as env-refs ("env:VAR_NAME") so secrets
// live in Vercel env, not the database.

export type ShopifyOrder = {
  name: string; // "#244513"
  legacyResourceId: string;
  createdAt: string;
  fulfillmentStatus: string;
  financialStatus: string;
  total: string;
  currency: string;
  lineItems: { title: string; quantity: number }[];
  tracking: { company: string | null; number: string | null; url: string | null }[];
  statusPageUrl: string | null;
};

export function resolveShopifyToken(ref: string): string | null {
  if (!ref || ref === "PENDING") return null;
  if (ref.startsWith("env:")) return process.env[ref.slice(4)] ?? null;
  return ref; // raw token stored directly (discouraged, but supported)
}

export async function fetchOrdersByEmail(opts: {
  shopifyDomain: string;
  token: string;
  email: string;
  first?: number;
}): Promise<{ orders: ShopifyOrder[]; storeHandle: string } | { error: string }> {
  const query = `
    query OrdersByEmail($q: String!, $first: Int!) {
      orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) {
        nodes {
          name
          legacyResourceId
          createdAt
          displayFulfillmentStatus
          displayFinancialStatus
          statusPageUrl
          totalPriceSet { shopMoney { amount currencyCode } }
          lineItems(first: 10) { nodes { title quantity } }
          fulfillments(first: 5) { trackingInfo { company number url } }
        }
      }
    }`;
  // Exact-match email filter; escape quotes defensively.
  const q = `email:${JSON.stringify(opts.email)}`;

  let res: Response;
  try {
    res = await fetch(`https://${opts.shopifyDomain}/admin/api/2025-07/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": opts.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { q, first: opts.first ?? 5 } }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { error: `Shopify request failed: ${String(err)}` };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.data?.orders) {
    return { error: `Shopify error ${res.status}: ${JSON.stringify(data?.errors ?? "").slice(0, 200)}` };
  }

  type Node = {
    name: string;
    legacyResourceId: string;
    createdAt: string;
    displayFulfillmentStatus: string;
    displayFinancialStatus: string;
    statusPageUrl: string | null;
    totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    lineItems: { nodes: { title: string; quantity: number }[] };
    fulfillments: { trackingInfo: { company: string | null; number: string | null; url: string | null }[] }[];
  };

  const orders = (data.data.orders.nodes as Node[]).map((o) => ({
    name: o.name,
    legacyResourceId: o.legacyResourceId,
    createdAt: o.createdAt,
    fulfillmentStatus: o.displayFulfillmentStatus,
    financialStatus: o.displayFinancialStatus,
    total: o.totalPriceSet.shopMoney.amount,
    currency: o.totalPriceSet.shopMoney.currencyCode,
    lineItems: o.lineItems.nodes,
    tracking: o.fulfillments.flatMap((f) => f.trackingInfo),
    statusPageUrl: o.statusPageUrl,
  }));

  return { orders, storeHandle: opts.shopifyDomain.replace(".myshopify.com", "") };
}
