import { PrismaClient } from "@prisma/client";
import { upcomingWindow } from "./seed";
process.env.DATABASE_URL ??= "file:./medicontrol.db";
async function main() {
  const db = new PrismaClient(); const { start, end } = upcomingWindow();
  const [specialties, specialists, patients, slots] = await Promise.all([db.specialty.count(), db.specialist.count(), db.patient.count(), db.availabilitySlot.findMany({ where: { startsAt: { gte: start, lt: end } }, select: { startsAt: true } })]);
  const days = new Set(slots.map((slot) => slot.startsAt.toISOString().slice(0, 10))).size;
  console.log(JSON.stringify({ specialties, specialists, patients, slots: slots.length, days }, null, 2));
  await db.$disconnect();
  if (specialties < 3 || specialists < 8 || patients < 3 || days < 14) process.exitCode = 1;
}
void main();
