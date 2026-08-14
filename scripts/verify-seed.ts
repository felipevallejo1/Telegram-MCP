import { AppointmentStatus, PrismaClient, SlotStatus } from "@prisma/client";
import { buenosAiresDayWindow, upcomingWindow } from "./seed";

process.env.DATABASE_URL ??= "file:./medicontrol.db";

async function main() {
  const db = new PrismaClient();
  const now = new Date();
  const { start, end } = upcomingWindow(now);
  const today = buenosAiresDayWindow(now);
  const [specialties, specialists, patients, slots, appointmentsToday, patientRowsToday, availableToday, futureAppointments] =
    await Promise.all([
      db.specialty.count(),
      db.specialist.count({ where: { active: true } }),
      db.patient.count(),
      db.availabilitySlot.findMany({ where: { startsAt: { gte: start, lt: end } }, select: { startsAt: true } }),
      db.appointment.count({ where: { status: AppointmentStatus.BOOKED, slot: { startsAt: { gte: today.start, lt: today.end } } } }),
      db.appointment.findMany({
        where: { status: AppointmentStatus.BOOKED, slot: { startsAt: { gte: today.start, lt: today.end } } },
        distinct: ["patientId"],
        select: { patientId: true },
      }),
      db.availabilitySlot.count({ where: { status: SlotStatus.AVAILABLE, startsAt: { gte: today.start, lt: today.end } } }),
      db.appointment.count({ where: { status: AppointmentStatus.BOOKED, slot: { startsAt: { gte: now } } } }),
    ]);
  const days = new Set(slots.map((slot) => slot.startsAt.toISOString().slice(0, 10))).size;
  const result = {
    specialties,
    specialists,
    patients,
    futureAvailabilitySlots: slots.length,
    availabilityDays: days,
    appointmentsToday,
    patientsWithAppointmentsToday: patientRowsToday.length,
    availableSlotsToday: availableToday,
    futureAppointments,
  };
  console.log(JSON.stringify(result, null, 2));
  await db.$disconnect();
  if (
    specialties < 3 ||
    specialists < 8 ||
    patients < 6 ||
    days < 14 ||
    appointmentsToday < 3 ||
    patientRowsToday.length < 2 ||
    availableToday < 4 ||
    futureAppointments < 1
  ) process.exitCode = 1;
}

void main();
