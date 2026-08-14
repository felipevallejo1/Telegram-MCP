"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cancelAppointment, reserveAppointment } from "@/lib/appointments";
import { AppointmentOwnershipError, ReservationConflictError } from "@/lib/domain-errors";
import { DEMO_SESSION_COOKIE, getDemoPatient } from "@/lib/demo-session";
import { prisma } from "@/lib/prisma";

const safeText = (value: FormDataEntryValue | null) => typeof value === "string" ? value.trim() : "";

export async function loginDemoAction(formData: FormData) {
  const patientId = safeText(formData.get("patientId"));
  const patient = await prisma.patient.findFirst({ where: { id: patientId, email: { endsWith: "@example.test" } } });
  if (!patient) redirect("/login?error=Paciente%20demo%20no%20válido.");
  const store = await cookies();
  store.set(DEMO_SESSION_COOKIE, patient.id, { httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: 60 * 60 * 8 });
  redirect("/");
}

export async function logoutDemoAction() { (await cookies()).delete(DEMO_SESSION_COOKIE); redirect("/"); }

export async function reserveDemoAction(formData: FormData) {
  const patient = await getDemoPatient();
  if (!patient) redirect("/login?next=/reservar");
  const specialistId = safeText(formData.get("specialistId")); const slotId = safeText(formData.get("slotId"));
  if (!specialistId || !slotId || formData.get("confirmed") !== "on") redirect(`/reservar?specialistId=${encodeURIComponent(specialistId)}&slotId=${encodeURIComponent(slotId)}&error=Confirmá%20la%20reserva.`);
  let appointment;
  try { appointment = await reserveAppointment({ patientId: patient.id, specialistId, slotId }); }
  catch (error) { const message = error instanceof ReservationConflictError ? "El horario ya fue reservado. Elegí otro disponible." : "No fue posible reservar el turno demo."; redirect(`/reservar?specialistId=${encodeURIComponent(specialistId)}&slotId=${encodeURIComponent(slotId)}&error=${encodeURIComponent(message)}`); }
  redirect(`/reserva-confirmada?id=${encodeURIComponent(appointment.id)}`);
}

export async function cancelDemoAction(formData: FormData) {
  const patient = await getDemoPatient();
  if (!patient) redirect("/login?next=/mis-turnos");
  const appointmentId = safeText(formData.get("appointmentId"));
  if (!appointmentId || formData.get("confirmed") !== "on") redirect("/mis-turnos?error=Confirmá%20la%20cancelación.");
  try { await cancelAppointment({ appointmentId, patientId: patient.id }); }
  catch (error) { const message = error instanceof AppointmentOwnershipError ? "No podés cancelar ese turno." : "No fue posible cancelar el turno demo."; redirect(`/mis-turnos?error=${encodeURIComponent(message)}`); }
  redirect("/mis-turnos?success=Turno%20demo%20cancelado.%20El%20horario%20volvió%20a%20estar%20disponible.");
}
