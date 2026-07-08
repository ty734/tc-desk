// Replaces the seed's placeholder inboundToken with a real random token and
// prints it (the token doubles as the inbound webhook's auth secret).
import { readFileSync } from "fs";
import { randomBytes } from "crypto";

const env = readFileSync(`${__dirname}/../.env`, "utf8");
for (const k of ["DATABASE_URL", "DIRECT_URL"]) {
  const m = env.match(new RegExp(`^${k}="?([^"\\r\\n]+)"?`, "m"));
  if (m) process.env[k] = m[1];
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  const inbox = await db.inbox.findUnique({ where: { brand: "living-well" } });
  if (!inbox) throw new Error("living-well inbox not found");

  let token = inbox.inboundToken;
  if (token.startsWith("pending-")) {
    token = randomBytes(24).toString("hex");
    await db.inbox.update({ where: { id: inbox.id }, data: { inboundToken: token } });
    console.log("updated inboundToken");
  } else {
    console.log("inboundToken already set");
  }
  console.log("TOKEN:" + token);
  await db.$disconnect();
}
main();
