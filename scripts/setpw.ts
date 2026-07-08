// Dev helper: sets a user's password. Usage: npx tsx scripts/setpw.ts <email> <newPassword>
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error("usage: setpw.ts <email> <password>");
  await db.user.update({
    where: { email },
    data: { passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log(`password updated for ${email}`);
}

main().finally(() => db.$disconnect());
