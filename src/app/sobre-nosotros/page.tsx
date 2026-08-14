import { SiteHeader } from "@/components/site-header";

const values = [
  ["Cercanía", "Diseñamos una experiencia clara y respetuosa para cada persona."],
  ["Confianza", "Trabajamos con información simple, decisiones transparentes y mejora continua."],
  ["Accesibilidad", "Buscamos que organizar una consulta sea fácil, sin importar dónde estés."],
];

export default function AboutPage() {
  return <>
    <SiteHeader />
    <main className="about-page">
      <section className="about-hero" aria-labelledby="about-title">
        <p className="eyebrow">Sobre nosotros</p>
        <h1 id="about-title">Tecnología cercana para organizar mejor el cuidado.</h1>
        <p>MediControl es una plataforma demo creada para simplificar la conexión entre personas y especialistas. Desde 2016, hace 10 años, acompañamos la evolución de la agenda de salud con herramientas simples y claras.</p>
      </section>

      <section className="about-story" aria-labelledby="story-title">
        <div><p className="eyebrow">Nuestra historia</p><h2 id="story-title">Una década haciendo más simple cada paso.</h2></div>
        <p>Nacimos con una idea concreta: que encontrar disponibilidad, conocer modalidades y coordinar un turno no debería ser complicado. Hoy seguimos desarrollando MediControl como un entorno demostrativo, centrado en una experiencia útil y comprensible.</p>
      </section>

      <section aria-labelledby="values-title">
        <div className="about-section-heading"><p className="eyebrow">Lo que nos guía</p><h2 id="values-title">Nuestros valores</h2></div>
        <div className="about-values">
          {values.map(([title, description]) => <article key={title}><span aria-hidden="true">+</span><h3>{title}</h3><p>{description}</p></article>)}
        </div>
      </section>

      <section className="about-goals" aria-labelledby="goals-title">
        <div><p className="eyebrow">Mirada a futuro</p><h2 id="goals-title">Objetivos a largo plazo</h2></div>
        <ul><li>Seguir reduciendo la complejidad de la gestión de turnos.</li><li>Construir herramientas inclusivas y fáciles de usar.</li><li>Impulsar decisiones informadas con experiencias transparentes.</li></ul>
      </section>
    </main>
  </>;
}
