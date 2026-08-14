import { beforeEach, describe, expect, it } from "vitest";
import { createPrismaRunStore } from "../bot/prisma-store";
import { prisma } from "../src/lib/prisma";
import type { Run } from "../bot/core";

const store = createPrismaRunStore(prisma);
const run = (suffix: string, createdAt = new Date("2026-01-01T00:00:00.000Z")): Run => ({
  id: `store-${suffix}`,
  updateId: `update-${suffix}`,
  chatHash: `hash-${suffix.startsWith("same") ? "same" : suffix}`,
  prompt: "solicitud ficticia segura",
  status: "PENDING",
  createdAt,
});

beforeEach(async () => {
  await prisma.agentRun.deleteMany({ where: { id: { startsWith: "store-" } } });
});

describe("PrismaRunStore", () => {
  it("crea una única solicitud por update y mapea todos los campos públicos", async () => {
    const first = run("one");
    expect(await store.create(first)).toBe("created");
    expect(await store.create({ ...first, id: "store-duplicate" })).toBe("duplicate");
    await store.transition(first.id, "PENDING", "RUNNING", { startedAt: new Date("2026-01-01T00:01:00.000Z") });
    await store.transition(first.id, "RUNNING", "COMPLETED", { finishedAt: new Date("2026-01-01T00:02:00.000Z"), verificationSummary: "Estado: completado. Archivos modificados: 0. Verificaciones: 0; tests: aprobados. Advertencias: 0." });
    expect(await store.get(first.id)).toMatchObject({
      ...first,
      status: "COMPLETED",
      startedAt: new Date("2026-01-01T00:01:00.000Z"),
      finishedAt: new Date("2026-01-01T00:02:00.000Z"),
      verificationSummary: "Estado: completado. Archivos modificados: 0. Verificaciones: 0; tests: aprobados. Advertencias: 0.",
    });
  });

  it("aplica transiciones condicionales y exactamente los patches recibidos", async () => {
    const pending = run("conditional");
    await store.create(pending);
    expect(await store.transition(pending.id, "CONFIRMED", "RUNNING", { startedAt: new Date("2026-01-01T00:01:00.000Z") })).toBe(false);
    expect((await store.get(pending.id))?.startedAt).toBeUndefined();
    expect(await store.transition(pending.id, "PENDING", "CONFIRMED")).toBe(true);
    expect(await store.transition(pending.id, "CONFIRMED", "RUNNING", { startedAt: new Date("2026-01-01T00:01:00.000Z") })).toBe(true);
    expect((await store.get(pending.id))?.startedAt).toEqual(new Date("2026-01-01T00:01:00.000Z"));
  });

  it("encuentra la última solicitud del hash y estados solicitados", async () => {
    const old = run("same-old", new Date("2026-01-01T00:00:00.000Z"));
    const latest = run("same-latest", new Date("2026-01-01T00:01:00.000Z"));
    const other = run("other", new Date("2026-01-01T00:02:00.000Z"));
    await store.create(old); await store.create(latest); await store.create(other);
    await store.transition(old.id, "PENDING", "CANCELLED", { finishedAt: new Date("2026-01-01T00:03:00.000Z") });
    expect(await store.findLatestForChat("hash-same", ["PENDING", "CONFIRMED"])).toMatchObject({ id: latest.id });
    expect(await store.findLatestForChat("hash-same", ["CANCELLED"])).toMatchObject({ id: old.id });
  });

  it("filtra y ordena findByStatuses por createdAt ascendente", async () => {
    const running = run("recover-running", new Date("2026-01-01T00:03:00.000Z"));
    const confirmed = run("recover-confirmed", new Date("2026-01-01T00:01:00.000Z"));
    const pending = run("recover-pending", new Date("2026-01-01T00:00:00.000Z"));
    await store.create(running); await store.create(confirmed); await store.create(pending);
    await store.transition(running.id, "PENDING", "CONFIRMED"); await store.transition(running.id, "CONFIRMED", "RUNNING");
    await store.transition(confirmed.id, "PENDING", "CONFIRMED");
    const found = await store.findByStatuses(["CONFIRMED", "RUNNING"]);
    expect(found.map((item) => item.id)).toEqual([confirmed.id, running.id]);
  });
});
