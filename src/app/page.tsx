import { Modality, SlotStatus } from "@prisma/client";
import { SpecialistCard } from "@/components/specialist-card";
import { SiteHeader } from "@/components/site-header";
import { prisma } from "@/lib/prisma";
import { searchSpecialists } from "@/lib/specialists";

export const dynamic = "force-dynamic";
type Search = Promise<{ q?: string; specialty?: string; city?: string; modality?: string }>;
export default async function Home({ searchParams }: { searchParams: Search }) {
  const query = await searchParams; const modality = Object.values(Modality).includes(query.modality as Modality) ? query.modality as Modality : undefined;
    const [specialties, cities, base] = await Promise.all([prisma.specialty.findMany({ orderBy: { name: "asc" } }), prisma.specialist.findMany({ where: { active: true }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }), searchSpecialists({ text: query.q, specialtySlug: query.specialty, city: query.city, modality })]);
    const specialists = await Promise.all(base.map(async (specialist) => ({ ...specialist, slots: await prisma.availabilitySlot.findMany({ where: { specialistId: specialist.id, status: SlotStatus.AVAILABLE, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" }, take: 1, select: { startsAt: true } }) })));
    return <><SiteHeader /><main><section className="hero"><p className="eyebrow">MediControl · entorno local</p><h1>Encontrá un horario ficticio</h1><p className="demo-notice">Proyecto demostrativo. Todos los profesionales, pacientes y turnos son ficticios.</p></section><form className="filters" action="/"><label>Buscar por nombre o especialidad<input name="q" defaultValue={query.q} /></label><label>Especialidad<select name="specialty" defaultValue={query.specialty ?? ""}><option value="">Todas</option>{specialties.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label><label>Ciudad<select name="city" defaultValue={query.city ?? ""}><option value="">Todas</option>{cities.map((item) => <option key={item.city} value={item.city}>{item.city}</option>)}</select></label><label>Modalidad<select name="modality" defaultValue={modality ?? ""}><option value="">Todas</option><option value="IN_PERSON">Presencial</option><option value="VIRTUAL">Virtual</option></select></label><button className="button" type="submit">Aplicar filtros</button></form><section aria-labelledby="results"><h2 id="results">Profesionales ficticios</h2>{specialists.length ? <div className="grid">{specialists.map((item) => <SpecialistCard key={item.id} specialist={item} />)}</div> : <p className="empty">No hay resultados para esos filtros.</p>}</section></main></>;
}
