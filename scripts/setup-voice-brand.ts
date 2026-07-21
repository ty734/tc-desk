// Configure a brand's voice channel: set its Twilio number and make sure the
// board's Channel field has a "Phone" option. Idempotent — safe to re-run.
//
//   npx tsx scripts/setup-voice-brand.ts <brand> <+E164Number>
//   npx tsx scripts/setup-voice-brand.ts longer-together +18015551234
//
// NOTE: writes to the DB in .env — that is the shared PROD Neon DB. Run only
// after the voice_channel migration has been applied.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const [brand, number] = process.argv.slice(2);
  if (!brand || !number) {
    console.error("usage: tsx scripts/setup-voice-brand.ts <brand> <+E164Number>");
    process.exit(1);
  }
  if (!/^\+\d{8,15}$/.test(number)) {
    console.error(`"${number}" is not E.164 (e.g. +18015551234)`);
    process.exit(1);
  }

  const inbox = await db.inbox.findUnique({
    where: { brand },
    include: { board: { include: { fields: { include: { options: true } } } } },
  });
  if (!inbox) {
    console.error(`no inbox for brand "${brand}"`);
    process.exit(1);
  }

  await db.inbox.update({ where: { id: inbox.id }, data: { twilioNumber: number } });
  console.log(`[voice] ${brand} → ${number}`);

  const channel = inbox.board.fields.find((f) => f.name === "Channel");
  if (channel && !channel.options.some((o) => o.label.toLowerCase() === "phone")) {
    const position = Math.max(0, ...channel.options.map((o) => o.position)) + 1;
    await db.fieldOption.create({
      data: { fieldId: channel.id, label: "Phone", color: "purple", position },
    });
    console.log(`[voice] added "Phone" option to the Channel field`);
  } else {
    console.log(`[voice] Channel "Phone" option already present (or no Channel field)`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
