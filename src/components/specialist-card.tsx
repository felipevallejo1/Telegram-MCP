import Link from "next/link";
import { formatBuenosAires, modalityLabel } from "@/lib/presentation";

export function SpecialistCard({ specialist }: { specialist: { id: string; firstName: string; lastName: string; city: string; modality: "IN_PERSON" | "VIRTUAL" | "BOTH"; specialty: { name: string }; slots?: { startsAt: Date }[] } }) {
  const next = specialist.slots?.[0];
  return <article className="card specialist-card"><div className="avatar" aria-hidden="true">{specialist.firstName[0]}{specialist.lastName[0]}</div><div><h2>{specialist.firstName} {specialist.lastName}</h2><p className="muted">{specialist.specialty.name} · {specialist.city}</p><p>{modalityLabel(specialist.modality)}</p><p className="availability">{next ? `Próximo horario: ${formatBuenosAires(next.startsAt)}` : "Sin horarios próximos disponibles"}</p><Link className="button secondary" href={`/especialistas/${specialist.id}`}>Ver perfil y horarios</Link></div></article>;
}
