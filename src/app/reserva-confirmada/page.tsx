import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { getDemoPatient } from "@/lib/demo-session";
import { formatBuenosAires } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function Confirmation({ searchParams }: { searchParams: Promise<{ id?: string }> }) { const { id } = await searchParams; const patient = await getDemoPatient(); const appointment = patient && id ? await prisma.appointment.findFirst({ where: { id, patientId: patient.id }, include: { specialist: true, slot: true } }) : null; return <><SiteHeader /><main className="narrow"><h1>Reserva confirmada</h1>{appointment ? <><p className="success">El turno fue reservado.</p><p><strong>{appointment.specialist.firstName} {appointment.specialist.lastName}</strong><br />{formatBuenosAires(appointment.slot.startsAt)}</p><Link className="button" href="/mis-turnos">Ver mis turnos</Link></> : <><p className="error">No encontramos esa reserva en tu sesión.</p><Link href="/">Volver al inicio</Link></>}</main></>; }
