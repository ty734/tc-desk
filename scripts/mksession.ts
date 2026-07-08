// Dev helper: mints a 1-hour session for a user so automated browser tests can
// log in without knowing a password. Usage: npx tsx scripts/mksession.ts [userId]
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const db = new PrismaClient();

async function main() {
  const userId = process.argv[2] ?? "cmr9gvs4h0000qfkks0336gxq";
  const id = randomBytes(32).toString("hex");
  await db.session.create({
    data: { id, userId, expiresAt: new Date(Date.now() + 3600_000) },
  });
  console.log("SESSION:" + id);
}

main().finally(() => db.$disconnect());
