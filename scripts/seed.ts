import { AppointmentStatus, Modality, PrismaClient, SlotStatus } from "@prisma/client";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATABASE_URL ??= "file:./medicontrol.db";

const specialties = [
  { name: "Clínica médica", slug: "aurora" },
  { name: "Cardiología", slug: "brisa" },
  { name: "Dermatología", slug: "cobalto" },
];

const people = [
  ["Ada", "Aster", "aurora", "Buenos Aires", Modality.VIRTUAL],
  ["Bruno", "Boreal", "brisa", "Córdoba", Modality.IN_PERSON],
  ["Cora", "Cenit", "cobalto", "Buenos Aires", Modality.BOTH],
  ["Dario", "Delta", "aurora", "Rosario", Modality.BOTH],
  ["Elena", "Eco", "brisa", "Córdoba", Modality.VIRTUAL],
  ["Fabian", "Faro", "cobalto", "Mendoza", Modality.IN_PERSON],
  ["Gala", "Grafito", "aurora", "Buenos Aires", Modality.VIRTUAL],
  ["Hugo", "Halo", "brisa", "Rosario", Modality.BOTH],
] as const;

const patients = [
  ["Paciente", "Uno", "paciente.uno@example.test", "+54 11 0000 0001", "1990-01-15T00:00:00.000Z"],
  ["Paciente", "Dos", "paciente.dos@example.test", "+54 11 0000 0002", "1988-05-20T00:00:00.000Z"],
  ["Paciente", "Tres", "paciente.tres@example.test", "+54 11 0000 0003", "1995-09-10T00:00:00.000Z"],
  ["Paciente", "Cuatro", "paciente.cuatro@example.test", "+54 11 0000 0004", "1992-03-12T00:00:00.000Z"],
  ["Paciente", "Cinco", "paciente.cinco@example.test", "+54 11 0000 0005", "1985-07-08T00:00:00.000Z"],
  ["Paciente", "Seis", "paciente.seis@example.test", "+54 11 0000 0006", "1998-11-25T00:00:00.000Z"],
] as const;

export function upcomingWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 15));
  return { start, end };
}

export function buenosAiresDayWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  const start = new Date(Date.UTC(value("year"), value("month") - 1, value("day"), 3));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

const atLocalHour = (dayStart: Date, hour: number, dayOffset = 0) =>
  new Date(dayStart.getTime() + dayOffset * 86_400_000 + hour * 3_600_000);

export async function seedDatabase(db: PrismaClient, now = new Date()) {
  for (const specialty of specialties) {
    await db.specialty.upsert({ where: { slug: specialty.slug }, update: { name: specialty.name }, create: specialty });
  }

  const specialtyIds = new Map((await db.specialty.findMany()).map((item) => [item.slug, item.id]));
  for (const [index, [firstName, lastName, specialtySlug, city, modality]] of people.entries()) {
    const specialtyId = specialtyIds.get(specialtySlug)!;
    await db.specialist.upsert({
      where: { id: `demo-specialist-${index + 1}` },
      update: {
        firstName,
        lastName,
        specialtyId,
        city,
        modality,
        active: true,
        bio: "Atención integral y seguimiento personalizado.",
        licenseLabel: `Matrícula MC-${String(index + 1).padStart(3, "0")}`,
        imagePath: `/images/fictitious/specialist-${index + 1}.svg`,
      },
      create: {
        id: `demo-specialist-${index + 1}`,
        firstName,
        lastName,
        specialtyId,
        city,
        modality,
        active: true,
        bio: "Atención integral y seguimiento personalizado.",
        licenseLabel: `Matrícula MC-${String(index + 1).padStart(3, "0")}`,
        imagePath: `/images/fictitious/specialist-${index + 1}.svg`,
      },
    });
  }

  for (const [index, [firstName, lastName, email, phone, birthDate]] of patients.entries()) {
    await db.patient.upsert({
      where: { email },
      update: { firstName, lastName, phone, birthDate: new Date(birthDate) },
      create: { id: `demo-patient-${index + 1}`, firstName, lastName, email, phone, birthDate: new Date(birthDate) },
    });
  }

  const { start } = upcomingWindow(now);
  const specialists = await db.specialist.findMany({ where: { active: true }, select: { id: true }, orderBy: { id: "asc" } });
  const futureSlots = specialists.flatMap((specialist, specialistIndex) =>
    Array.from({ length: 14 }, (_, day) => {
      const startsAt = new Date(start);
      startsAt.setUTCDate(start.getUTCDate() + day);
      startsAt.setUTCHours(13 + specialistIndex % 3, 0, 0, 0);
      return {
        id: `demo-slot-${specialist.id}-${startsAt.toISOString()}`,
        specialistId: specialist.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 1_800_000),
        status: SlotStatus.AVAILABLE,
      };
    }),
  );

  for (const slot of futureSlots) {
    await db.availabilitySlot.upsert({
      where: { specialistId_startsAt: { specialistId: slot.specialistId, startsAt: slot.startsAt } },
      update: { endsAt: slot.endsAt },
      create: slot,
    });
  }

  const { start: todayStart } = buenosAiresDayWindow(now);
  const querySlots = [
    ["demo-query-slot-today-booked-1", "demo-specialist-1", atLocalHour(todayStart, 9), SlotStatus.BOOKED],
    ["demo-query-slot-today-booked-2", "demo-specialist-2", atLocalHour(todayStart, 11), SlotStatus.BOOKED],
    ["demo-query-slot-today-booked-3", "demo-specialist-3", atLocalHour(todayStart, 15), SlotStatus.BOOKED],
    ["demo-query-slot-today-available-1", "demo-specialist-4", atLocalHour(todayStart, 10), SlotStatus.AVAILABLE],
    ["demo-query-slot-today-available-2", "demo-specialist-5", atLocalHour(todayStart, 12), SlotStatus.AVAILABLE],
    ["demo-query-slot-today-available-3", "demo-specialist-6", atLocalHour(todayStart, 14), SlotStatus.AVAILABLE],
    ["demo-query-slot-today-available-4", "demo-specialist-7", atLocalHour(todayStart, 16), SlotStatus.AVAILABLE],
    ["demo-query-slot-future-booked-1", "demo-specialist-8", atLocalHour(todayStart, 10, 1), SlotStatus.BOOKED],
  ] as const;

  for (const [id, specialistId, startsAt, status] of querySlots) {
    await db.availabilitySlot.upsert({
      where: { id },
      update: { specialistId, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), status },
      create: { id, specialistId, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), status },
    });
  }

  const seededAppointments = [
    ["demo-query-appointment-today-1", "demo-patient-1", "demo-specialist-1", "demo-query-slot-today-booked-1"],
    ["demo-query-appointment-today-2", "demo-patient-2", "demo-specialist-2", "demo-query-slot-today-booked-2"],
    ["demo-query-appointment-today-3", "demo-patient-1", "demo-specialist-3", "demo-query-slot-today-booked-3"],
    ["demo-query-appointment-future-1", "demo-patient-4", "demo-specialist-8", "demo-query-slot-future-booked-1"],
  ] as const;

  for (const [id, patientId, specialistId, slotId] of seededAppointments) {
    await db.appointment.upsert({
      where: { id },
      update: { patientId, specialistId, slotId, status: AppointmentStatus.BOOKED, cancelledAt: null },
      create: { id, patientId, specialistId, slotId, status: AppointmentStatus.BOOKED },
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = new PrismaClient();
  seedDatabase(db)
    .then(() => console.log("Seeded MediControl data."))
    .finally(() => db.$disconnect());
}
