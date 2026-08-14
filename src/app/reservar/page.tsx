import Link from "next/link";
import { SlotStatus } from "@prisma/client";
import { reserveDemoAction } from "@/app/actions";
import { SiteHeader } from "@/components/site-header";
import { getDemoPatient } from "@/lib/demo-session";
import { formatBuenosAires, modalityLabel } from "@/lib/presentation";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function Reserve({ searchParams }: { searchParams: Promise<{ specialistId?: string; slotId?: string; error?: string }> }) {
  const p = await searchParams; const patient = await getDemoPatient();
  if (!patient) return <><SiteHeader /><main className="narrow"><h1>Sesión demo requerida</h1><p>Elegí un paciente ficticio antes de reservar.</p><Link className="button" href="/login">Ingresar demo</Link></main></>;
  const slot = p.slotId ? await prisma.availabilitySlot.findFirst({ where: { id: p.slotId, specialistId: p.specialistId, status: SlotStatus.AVAILABLE }, include: { specialist: { include: { specialty: true } } } }) : null;
  return <><SiteHeader /><main className="narrow"><h1>Confirmar turno demo</h1>{p.error && <p role="alert" className="error">{p.error}</p>}{!slot ? <><p className="empty">El horario ya no está disponible.</p><Link href="/">Buscar otro horario</Link></> : <form action={reserveDemoAction} className="stack"><p><strong>{slot.specialist.firstName} {slot.specialist.lastName}</strong><br />{slot.specialist.specialty.name} · {modalityLabel(slot.specialist.modality)}<br />{formatBuenosAires(slot.startsAt)}</p><input type="hidden" name="specialistId" value={slot.specialistId} /><input type="hidden" name="slotId" value={slot.id} /><label className="check"><input type="checkbox" name="confirmed" required />Confirmo reservar este turno ficticio para {patient.firstName}.</label><button className="button">Confirmar reserva</button></form>}</main></>;
}
