import Link from "next/link";
import { formatBuenosAires, modalityLabel } from "@/lib/presentation";

export function SpecialistCard({ specialist }: { specialist: { id: string; firstName: string; lastName: string; city: string; modality: "IN_PERSON" | "VIRTUAL" | "BOTH"; specialty: { name: string }; slots?: { startsAt: Date }[] } }) {
  const next = specialist.slots?.[0];
  return <article className="card specialist-card">
    <div className="card-top">
      <div className="avatar" aria-hidden="true">{specialist.firstName[0]}{specialist.lastName[0]}</div>
      <span className="verified-badge">✓ Verificado demo</span>
    </div>
    <div className="card-body">
      <p className="specialty-tag">{specialist.specialty.name}</p>
      <h2>{specialist.firstName} {specialist.lastName}</h2>
      <div className="metadata"><span>⌖ {specialist.city}</span><span>◉ {modalityLabel(specialist.modality)}</span></div>
      <div className={`availability-box ${next ? "" : "unavailable"}`}>
        <span className="calendar-icon" aria-hidden="true">▦</span>
        <div><small>Próxima disponibilidad</small><strong>{next ? formatBuenosAires(next.startsAt) : "Sin horarios próximos"}</strong></div>
      </div>
      <Link className="button secondary" href={`/especialistas/${specialist.id}`}>Ver perfil y horarios <span aria-hidden="true">→</span></Link>
    </div>
  </article>;
}
