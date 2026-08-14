import { Modality, SlotStatus } from "@prisma/client";
import { SpecialistCard } from "@/components/specialist-card";
import { SiteHeader } from "@/components/site-header";
import { prisma } from "@/lib/prisma";
import { searchSpecialists } from "@/lib/specialists";

export const dynamic = "force-dynamic";

type Search = Promise<{ q?: string; specialty?: string; city?: string; modality?: string }>;

export default async function Home({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const modality = Object.values(Modality).includes(query.modality as Modality)
    ? query.modality as Modality
    : undefined;
  const [specialties, cities, base] = await Promise.all([
    prisma.specialty.findMany({ orderBy: { name: "asc" } }),
    prisma.specialist.findMany({ where: { active: true }, distinct: ["city"], select: { city: true }, orderBy: { city: "asc" } }),
    searchSpecialists({ text: query.q, specialtySlug: query.specialty, city: query.city, modality }),
  ]);
  const specialists = await Promise.all(base.map(async (specialist) => ({
    ...specialist,
    slots: await prisma.availabilitySlot.findMany({
      where: { specialistId: specialist.id, status: SlotStatus.AVAILABLE, startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take: 1,
      select: { startsAt: true },
    }),
  })));

  return <>
    <SiteHeader />
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-dot" /> Agenda médica inteligente</p>
          <h1>Tu próximo turno, <span>más cerca.</span></h1>
          <p className="hero-lead">Explorá especialistas, compará modalidades y encontrá el horario ideal en pocos pasos.</p>
          <p className="demo-notice"><span aria-hidden="true">ⓘ</span> Proyecto demostrativo. Todos los profesionales, pacientes y turnos son ficticios.</p>
        </div>
        <div className="hero-panel" aria-label="Características de la plataforma">
          <div className="pulse-orbit"><span>+</span></div>
          <p className="panel-kicker">MediControl</p>
          <p className="panel-title">Salud simple,<br />agenda clara.</p>
          <div className="hero-metrics">
            <div><strong>{specialties.length}</strong><span>especialidades</span></div>
            <div><strong>{cities.length}</strong><span>ciudades</span></div>
            <div><strong>14</strong><span>días de agenda</span></div>
          </div>
        </div>
      </section>

      <section className="search-shell" aria-labelledby="search-title">
        <div className="section-heading">
          <div><p className="eyebrow">Buscador</p><h2 id="search-title">Encontrá tu especialista</h2></div>
          <span className="secure-label">Datos 100% ficticios</span>
        </div>
        <form className="filters" action="/">
          <label className="search-field">Buscar por nombre o especialidad<input name="q" defaultValue={query.q} placeholder="Ej. cardiología" /></label>
          <label>Especialidad<select name="specialty" defaultValue={query.specialty ?? ""}><option value="">Todas</option>{specialties.map((item) => <option key={item.id} value={item.slug}>{item.name}</option>)}</select></label>
          <label>Ciudad<select name="city" defaultValue={query.city ?? ""}><option value="">Todas</option>{cities.map((item) => <option key={item.city} value={item.city}>{item.city}</option>)}</select></label>
          <label>Modalidad<select name="modality" defaultValue={modality ?? ""}><option value="">Todas</option><option value="IN_PERSON">Presencial</option><option value="VIRTUAL">Virtual</option></select></label>
          <button className="button" type="submit"><span aria-hidden="true">⌕</span> Buscar turnos</button>
        </form>
      </section>

      <section className="results-section" aria-labelledby="results">
        <div className="results-heading"><div><p className="eyebrow">Profesionales</p><h2 id="results">Especialistas disponibles</h2></div><span className="result-count">{specialists.length} resultados</span></div>
        {specialists.length
          ? <div className="grid">{specialists.map((item) => <SpecialistCard key={item.id} specialist={item} />)}</div>
          : <p className="empty">No hay resultados para esos filtros.</p>}
      </section>
    </main>
  </>;
}
