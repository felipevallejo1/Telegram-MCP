export const BUENOS_AIRES_TIME_ZONE = "America/Argentina/Buenos_Aires";

export function formatBuenosAires(value: Date | string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: BUENOS_AIRES_TIME_ZONE, dateStyle: "full", timeStyle: "short" }).format(new Date(value));
}

export function modalityLabel(value: "IN_PERSON" | "VIRTUAL" | "BOTH") {
  return value === "IN_PERSON" ? "Presencial" : value === "VIRTUAL" ? "Virtual" : "Presencial o virtual";
}
