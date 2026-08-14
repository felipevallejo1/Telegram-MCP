import Link from "next/link";
import { logoutDemoAction } from "@/app/actions";
import { getDemoPatient } from "@/lib/demo-session";

export async function SiteHeader() {
  const patient = await getDemoPatient();
  return <header className="site-header"><Link className="brand" href="/">MediControl <span>demo</span></Link><nav aria-label="Navegación principal"><Link href="/">Buscar</Link>{patient ? <><Link href="/mis-turnos">Mis turnos</Link><span className="session-label">{patient.firstName} (demo)</span><form action={logoutDemoAction}><button className="link-button">Salir</button></form></> : <Link href="/login">Ingresar demo</Link>}</nav></header>;
}
