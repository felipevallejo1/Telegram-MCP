import Link from "next/link";
import { AppointmentStatus } from "@prisma/client";
import { cancelDemoAction } from "@/app/actions";
import { SiteHeader } from "@/components/site-header";
import { getDemoPatient } from "@/lib/demo-session";
import { formatBuenosAires } from "@/lib/presentation";
import { listAppointmentsForPatient } from "@/lib/appointments";
export const dynamic = "force-dynamic";
export default async function MyAppointments({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const p = await searchParams; const patient = await getDemoPatient();
  if (!patient) return <><SiteHeader /><main className="narrow"><h1>Sesión demo requerida</h1><p>Ingresá con un paciente ficticio para ver sus turnos.</p><Link className="button" href="/login">Ingresar demo</Link></main></>;
  const appointments = await listAppointmentsForPatient(patient.id);
  return <><SiteHeader /><main><h1>Mis turnos demo</h1>{p.error && <p className="error" role="alert">{p.error}</p>}{p.success && <p className="success" role="status">{p.success}</p>}{appointments.length ? <div className="stack">{appointments.map((appointment) => <article className="card" key={appointment.id}><h2>{appointment.specialist.firstName} {appointment.specialist.lastName}</h2><p>{appointment.specialist.specialty.name} · {formatBuenosAires(appointment.slot.startsAt)}</p><p className={appointment.status === AppointmentStatus.CANCELLED ? "muted" : "availability"}>{appointment.status === AppointmentStatus.CANCELLED ? "Cancelado" : "Reservado"}</p>{appointment.status === AppointmentStatus.BOOKED ? <form action={cancelDemoAction} className="cancel"><input type="hidden" name="appointmentId" value={appointment.id} /><label className="check"><input type="checkbox" name="confirmed" required />Confirmo cancelar este turno ficticio.</label><button className="button danger">Cancelar turno</button></form> : null}</article>)}</div> : <p className="empty">Todavía no reservaste turnos ficticios. <Link href="/">Buscar horarios</Link></p>}</main></>;
}
