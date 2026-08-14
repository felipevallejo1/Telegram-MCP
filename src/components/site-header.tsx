import Link from "next/link";
import { logoutDemoAction } from "@/app/actions";
import { getDemoPatient } from "@/lib/demo-session";

export async function SiteHeader() {
  const patient = await getDemoPatient();
  return <header className="site-header">
    <Link className="brand" href="/">
      <span className="brand-mark" aria-hidden="true">+</span>
      <span className="brand-copy">MediControl <small>demo</small></span>
    </Link>
    <nav aria-label="Navegación principal">
      <Link href="/">Buscar</Link>
      {patient ? <>
        <Link href="/mis-turnos">Mis turnos</Link>
        <span className="session-label"><span className="session-avatar">{patient.firstName[0]}</span>{patient.firstName}</span>
        <form action={logoutDemoAction}><button className="link-button">Salir</button></form>
      </> : <Link className="nav-cta" href="/login">Ingresar demo</Link>}
    </nav>
  </header>;
}
