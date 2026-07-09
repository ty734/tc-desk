import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, getBoardMembership } from "@/lib/auth";
import { fetchOrdersByEmail, resolveShopifyToken } from "@/lib/shopify";
import { getSubscriptionsByEmail, rechargeKeyForBrand, type RechargeSubscription } from "@/lib/recharge";

// Read-only order lookup for the ticket sidebar (spec §8). Uses the ticket's
// Inbox store credentials, so each brand queries its own Shopify.
export async function GET(_req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Not logged in." }, { status: 401 });

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { inbox: true },
  });
  if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  if (!(await getBoardMembership(user.id, ticket.boardId))) {
    return NextResponse.json({ error: "Not a member of this board." }, { status: 403 });
  }

  const token = resolveShopifyToken(ticket.inbox.shopifyToken);
  if (!token || !ticket.inbox.shopifyDomain || ticket.inbox.shopifyDomain === "PENDING") {
    return NextResponse.json({ configured: false, orders: [] });
  }
  if (!ticket.customerEmail) {
    return NextResponse.json({ configured: true, noEmail: true, orders: [] });
  }

  // Orders + subscriptions fetched together; Recharge is optional per brand.
  const rcKey = rechargeKeyForBrand(ticket.inbox.brand);
  const [result, subscriptions] = await Promise.all([
    fetchOrdersByEmail({
      shopifyDomain: ticket.inbox.shopifyDomain,
      token,
      email: ticket.customerEmail,
    }),
    rcKey
      ? getSubscriptionsByEmail(rcKey, ticket.customerEmail).catch((err): RechargeSubscription[] => {
          console.error("[recharge]", err);
          return [];
        })
      : Promise.resolve([] as RechargeSubscription[]),
  ]);
  if ("error" in result) {
    console.error("[shopify]", result.error);
    return NextResponse.json({ configured: true, error: "Shopify lookup failed.", orders: [], subscriptions }, { status: 502 });
  }

  return NextResponse.json({ configured: true, orders: result.orders, storeHandle: result.storeHandle, subscriptions });
}
