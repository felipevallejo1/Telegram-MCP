import { Modality, PrismaClient, SlotStatus } from "@prisma/client";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.env.DATABASE_URL ??= "file:./medicontrol.db";
const specialties = [{ name: "Especialidad Aurora (ficticia)", slug: "aurora" }, { name: "Especialidad Brisa (ficticia)", slug: "brisa" }, { name: "Especialidad Cobalto (ficticia)", slug: "cobalto" }];
const people = [["Ada", "Aster", "aurora", "Ciudad Ficticia Norte", Modality.VIRTUAL], ["Bruno", "Boreal", "brisa", "Ciudad Ficticia Sur", Modality.IN_PERSON], ["Cora", "Cenit", "cobalto", "Ciudad Ficticia Norte", Modality.BOTH], ["Dario", "Delta", "aurora", "Ciudad Ficticia Este", Modality.BOTH], ["Elena", "Eco", "brisa", "Ciudad Ficticia Sur", Modality.VIRTUAL], ["Fabian", "Faro", "cobalto", "Ciudad Ficticia Oeste", Modality.IN_PERSON], ["Gala", "Grafito", "aurora", "Ciudad Ficticia Norte", Modality.VIRTUAL], ["Hugo", "Halo", "brisa", "Ciudad Ficticia Este", Modality.BOTH]] as const;
const patients = [["Paciente", "Uno", "paciente.uno@example.test", "+54 11 0000 0001", "1990-01-15T00:00:00.000Z"], ["Paciente", "Dos", "paciente.dos@example.test", "+54 11 0000 0002", "1988-05-20T00:00:00.000Z"], ["Paciente", "Tres", "paciente.tres@example.test", "+54 11 0000 0003", "1995-09-10T00:00:00.000Z"]] as const;
export function upcomingWindow(now = new Date()) { const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 15)); return { start, end }; }
export async function seedDatabase(db: PrismaClient, now = new Date()) {
  for (const specialty of specialties) await db.specialty.upsert({ where: { slug: specialty.slug }, update: { name: specialty.name }, create: specialty });
  const ids = new Map((await db.specialty.findMany()).map((item) => [item.slug, item.id]));
  for (const [index, [firstName, lastName, specialtySlug, city, modality]] of people.entries()) { const specialtyId = ids.get(specialtySlug)!; await db.specialist.upsert({ where: { id: `demo-specialist-${index + 1}` }, update: { firstName, lastName, specialtyId, city, modality, active: true }, create: { id: `demo-specialist-${index + 1}`, firstName, lastName, specialtyId, city, modality, active: true, bio: "Perfil ficticio para demostración; no presta atención real.", licenseLabel: `Matrícula ficticia DEMO-${String(index + 1).padStart(3, "0")}`, imagePath: `/images/fictitious/specialist-${index + 1}.svg` } }); }
  for (const [index, [firstName, lastName, email, phone, birthDate]] of patients.entries()) await db.patient.upsert({ where: { email }, update: { firstName, lastName, phone, birthDate: new Date(birthDate) }, create: { id: `demo-patient-${index + 1}`, firstName, lastName, email, phone, birthDate: new Date(birthDate) } });
  const { start } = upcomingWindow(now); const all = await db.specialist.findMany({ where: { active: true }, select: { id: true } });
  const slots = all.flatMap((specialist, specialistIndex) => Array.from({ length: 14 }, (_, day) => { const startsAt = new Date(start); startsAt.setUTCDate(start.getUTCDate() + day); startsAt.setUTCHours(13 + specialistIndex % 3, 0, 0, 0); return { id: `demo-slot-${specialist.id}-${startsAt.toISOString()}`, specialistId: specialist.id, startsAt, endsAt: new Date(startsAt.getTime() + 1800000), status: SlotStatus.AVAILABLE }; }));
  for (const slot of slots) {
    await db.availabilitySlot.upsert({
      where: { specialistId_startsAt: { specialistId: slot.specialistId, startsAt: slot.startsAt } },
      update: { endsAt: slot.endsAt },
      create: slot
    });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = new PrismaClient();
  seedDatabase(db).then(() => console.log("Seeded fictional MediControl data.")).finally(() => db.$disconnect());
}
