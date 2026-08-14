import { Modality, SlotStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
export interface SpecialistSearchFilters { text?: string; specialtySlug?: string; city?: string; modality?: Modality; }
function modalities(modality: Modality | undefined) { if (modality === Modality.VIRTUAL) return { in: [Modality.VIRTUAL, Modality.BOTH] }; if (modality === Modality.IN_PERSON) return { in: [Modality.IN_PERSON, Modality.BOTH] }; return modality ? { in: [Modality.BOTH] } : undefined; }
export async function searchSpecialists(filters: SpecialistSearchFilters = {}) {
  const text = filters.text?.trim().toLocaleLowerCase();
  const results = await prisma.specialist.findMany({ where: { active: true, ...(filters.specialtySlug ? { specialty: { slug: filters.specialtySlug } } : {}), ...(filters.city ? { city: filters.city } : {}), ...(filters.modality ? { modality: modalities(filters.modality) } : {}) }, include: { specialty: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  return text ? results.filter((item) => [item.firstName, item.lastName, item.bio, item.specialty.name].join(" ").toLocaleLowerCase().includes(text)) : results;
}
export async function getSpecialistProfile(specialistId: string) { return prisma.specialist.findUnique({ where: { id: specialistId }, include: { specialty: true, slots: { where: { status: SlotStatus.AVAILABLE, startsAt: { gte: new Date() } }, orderBy: { startsAt: "asc" } } } }); }
