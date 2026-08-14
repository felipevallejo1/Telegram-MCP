import Link from "next/link";
import { loginDemoAction } from "@/app/actions";
import { SiteHeader } from "@/components/site-header";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) { const { error } = await searchParams; const patients = await prisma.patient.findMany({ where: { email: { endsWith: "@example.test" } }, orderBy: { firstName: "asc" } }); return <><SiteHeader /><main className="narrow"><h1>Ingresar</h1><p>Seleccioná tu perfil para continuar.</p>{error && <p className="error" role="alert">{error}</p>}<form action={loginDemoAction} className="stack"><label>Paciente<select name="patientId" required defaultValue=""><option value="" disabled>Seleccionar</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.firstName} {patient.lastName}</option>)}</select></label><button className="button">Ingresar</button></form><Link href="/">Volver a buscar</Link></main></>; }
