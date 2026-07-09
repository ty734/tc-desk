// Read-only Recharge lookups: a customer's subscriptions by email, for the
// chat bot and the ticket sidebar. Per-brand keys via env
// RECHARGE_API_KEY_<BRAND> (e.g. RECHARGE_API_KEY_LIVING_WELL), falling back
// to RECHARGE_API_KEY. No write endpoints are used anywhere — subscription
// changes always go through the customer portal or a human.

const API = "https://api.rechargeapps.com";

export type RechargeSubscription = {
  productTitle: string;
  variantTitle: string | null;
  status: string; // active | cancelled | expired
  quantity: number;
  price: string | null;
  nextChargeDate: string | null;
  frequency: string; // "every 3 month(s)"
  cancelledAt: string | null;
};

export function rechargeKeyForBrand(brand: string): string | null {
  const envName = `RECHARGE_API_KEY_${brand.toUpperCase().replace(/-/g, "_")}`;
  return process.env[envName] ?? process.env.RECHARGE_API_KEY ?? null;
}

async function rcFetch(key: string, path: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { "X-Recharge-Access-Token": key, "X-Recharge-Version": "2021-11" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Recharge ${res.status}: ${(await res.text()).slice(0, 150)}`);
    return res.json();
  }
}

export async function getSubscriptionsByEmail(
  key: string,
  email: string
): Promise<RechargeSubscription[]> {
  const { customers } = await rcFetch(key, `/customers?email=${encodeURIComponent(email.toLowerCase())}`);
  if (!customers?.length) return [];

  const out: RechargeSubscription[] = [];
  for (const customer of customers.slice(0, 2)) {
    const { subscriptions } = await rcFetch(key, `/subscriptions?customer_id=${customer.id}&limit=20`);
    for (const s of subscriptions ?? []) {
      out.push({
        productTitle: s.product_title,
        variantTitle: s.variant_title || null,
        status: s.status?.toLowerCase() ?? "unknown",
        quantity: s.quantity ?? 1,
        price: s.price ?? null,
        nextChargeDate: s.next_charge_scheduled_at ?? null,
        frequency: `every ${s.order_interval_frequency} ${s.order_interval_unit}${Number(s.order_interval_frequency) > 1 ? "s" : ""}`,
        cancelledAt: s.cancelled_at ?? null,
      });
    }
  }
  // Active first, then most recently relevant.
  return out.sort((a, b) => (a.status === "active" ? -1 : 1) - (b.status === "active" ? -1 : 1));
}
