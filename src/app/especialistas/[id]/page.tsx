import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { formatBuenosAires, modalityLabel } from "@/lib/presentation";
import { getSpecialistProfile } from "@/lib/specialists";
export const dynamic = "force-dynamic";
export default async function SpecialistPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const specialist = await getSpecialistProfile(id); if (!specialist) notFound(); return <><SiteHeader /><main><Link href="/">← Volver a buscar</Link><section className="profile"><div className="avatar large" aria-hidden="true">{specialist.firstName[0]}{specialist.lastName[0]}</div><div><h1>{specialist.firstName} {specialist.lastName}</h1><p>{specialist.specialty.name} · {specialist.city}</p><p>{modalityLabel(specialist.modality)}</p><p>{specialist.bio}</p><p className="muted">{specialist.licenseLabel}</p></div></section><section><h2>Horarios disponibles</h2>{specialist.slots.length ? <ul className="slots">{specialist.slots.map((slot) => <li key={slot.id}><span>{formatBuenosAires(slot.startsAt)}</span><Link className="button" href={`/reservar?specialistId=${specialist.id}&slotId=${slot.id}`}>Elegir</Link></li>)}</ul> : <p className="empty">No hay horarios disponibles.</p>}</section></main></>; }
