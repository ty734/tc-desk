// Seeds the dedicated "Social" board for the living-well inbox and points
// Inbox.socialBoardId at it, so FB/IG comments + DMs land on their own board
// instead of the email queue (src/lib/meta-ingest.ts falls back to the
// primary board while socialBoardId is null).
//
// Idempotent — if socialBoardId is already set this is a no-op. Board +
// columns + Channel field + memberships + the inbox pointer are created in
// one transaction, so a partial run can't leave a dangling half-seeded board.
//
// Run (supervised, against prod, AFTER `prisma migrate deploy` applies
// 20260715000000_social_board):
//   npx tsx scripts/seed-social-board.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const BRAND = "living-well";
const SOCIAL_BOARD_NAME = "Social";

// The ingest chip lookup (meta-ingest.ts) matches field name "Channel" and
// option labels "facebook"/"instagram" case-insensitively.
const CHANNEL_FIELD = {
  name: "Channel",
  options: [
    { label: "Facebook", color: "blue" },
    { label: "Instagram", color: "pink" },
  ],
};

async function main() {
  const inbox = await db.inbox.findUnique({
    where: { brand: BRAND },
    include: { board: { include: { columns: true, members: true } } },
  });
  if (!inbox) throw new Error(`[seed-social-board] inbox "${BRAND}" not found`);

  if (inbox.socialBoardId) {
    console.log(
      `[seed-social-board] inbox "${BRAND}" already has a social board (${inbox.socialBoardId}) — nothing to do`
    );
    return;
  }

  const lastBoard = await db.board.findFirst({ orderBy: { position: "desc" } });
  // Mirror the primary board's columns (names + positions) so status routing
  // (New/Open/Pending/Solved/Closed) behaves identically.
  const columns = [...inbox.board.columns].sort((a, b) => a.position - b.position);

  await db.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        name: SOCIAL_BOARD_NAME,
        position: (lastBoard?.position ?? 0) + 1,
        columns: {
          create: columns.map((c) => ({ name: c.name, position: c.position })),
        },
        fields: {
          create: [
            {
              name: CHANNEL_FIELD.name,
              type: "select",
              position: 1,
              options: {
                create: CHANNEL_FIELD.options.map((o, i) => ({ ...o, position: i + 1 })),
              },
            },
          ],
        },
        // Everyone on the primary board joins the Social board with the same role.
        members: {
          create: inbox.board.members.map((m) => ({ userId: m.userId, role: m.role })),
        },
      },
    });

    await tx.inbox.update({ where: { id: inbox.id }, data: { socialBoardId: board.id } });

    console.log(
      `[seed-social-board] created board "${SOCIAL_BOARD_NAME}" (${board.id}) with ${columns.length} columns, ` +
        `${inbox.board.members.length} members, Channel field (Facebook/Instagram), and set inbox.socialBoardId`
    );
  });
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
