import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const DEMO_SESSION_COOKIE = "medicontrol_demo_patient";

export async function getDemoPatient() {
  const patientId = (await cookies()).get(DEMO_SESSION_COOKIE)?.value;
  if (!patientId) return null;
  return prisma.patient.findFirst({ where: { id: patientId, email: { endsWith: "@example.test" } } });
}
