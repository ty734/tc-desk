// Seeds one Inbox + its support board. Idempotent — safe to re-run.
// Adding a brand later (Longer Together) = call seedInbox with its values,
// or insert an Inbox row directly. No code change required.
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const db = new PrismaClient();

const STATUS_COLUMNS = ["New", "Open", "Pending", "Solved", "Closed"];

const TAG_FIELDS: { name: string; options: { label: string; color: string }[] }[] = [
  {
    name: "Channel",
    options: [
      { label: "Email", color: "blue" },
      { label: "Amazon", color: "orange" },
      { label: "Chat", color: "green" },
      { label: "Phone", color: "purple" },
    ],
  },
  {
    name: "Priority",
    options: [
      { label: "Low", color: "gray" },
      { label: "Med", color: "yellow" },
      { label: "High", color: "red" },
    ],
  },
  {
    name: "Topic",
    options: [
      { label: "Shipping", color: "teal" },
      { label: "Refund", color: "pink" },
      { label: "Product", color: "purple" },
      { label: "Subscription", color: "blue" },
      { label: "Other", color: "gray" },
    ],
  },
];

async function seedInbox(opts: {
  brand: string;
  name: string;
  supportEmail: string;
  fromName: string;
  sendingDomain: string;
  shopifyDomain: string;
  shopifyToken: string;
}) {
  const existing = await db.inbox.findUnique({ where: { brand: opts.brand } });
  if (existing) {
    console.log(`[seed] inbox "${opts.brand}" already exists (board ${existing.boardId})`);
    return existing;
  }

  const lastBoard = await db.board.findFirst({ orderBy: { position: "desc" } });
  const board = await db.board.create({
    data: {
      name: opts.name,
      position: (lastBoard?.position ?? 0) + 1,
      columns: { create: STATUS_COLUMNS.map((name, i) => ({ name, position: i + 1 })) },
      fields: {
        create: TAG_FIELDS.map((f, fi) => ({
          name: f.name,
          type: "select",
          position: fi + 1,
          options: { create: f.options.map((o, oi) => ({ ...o, position: oi + 1 })) },
        })),
      },
    },
  });

  const inbox = await db.inbox.create({
    data: {
      brand: opts.brand,
      name: opts.name,
      supportEmail: opts.supportEmail,
      fromName: opts.fromName,
      sendingDomain: opts.sendingDomain,
      // Placeholder until the Postmark inbound server exists (Phase B).
      inboundToken: `pending-${randomBytes(16).toString("hex")}`,
      shopifyDomain: opts.shopifyDomain,
      shopifyToken: opts.shopifyToken,
      boardId: board.id,
    },
  });

  // Every existing user becomes a member so agents see the board immediately.
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });
  for (const [i, user] of users.entries()) {
    await db.boardMember.upsert({
      where: { boardId_userId: { boardId: board.id, userId: user.id } },
      create: { boardId: board.id, userId: user.id, role: i === 0 ? "owner" : "member" },
      update: {},
    });
  }

  console.log(`[seed] created inbox "${opts.brand}" + board "${opts.name}" (${board.id})`);
  return inbox;
}

async function main() {
  await seedInbox({
    brand: "living-well",
    name: "Living Well Support",
    supportEmail: "support@livingwellwithdrmichelle.com",
    fromName: "Living Well Support",
    sendingDomain: "livingwellwithdrmichelle.com",
    shopifyDomain: "PENDING", // filled in Phase D
    shopifyToken: "PENDING", // filled in Phase D (env-ref)
  });
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
