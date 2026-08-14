import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ProcessSpawner } from "../bot/executor";
import { CodexQuestionPlanner, DatabaseQuestionAnswerer, QUESTION_PLAN_SCHEMA, buenosAiresDay, validateQuestionPlan, type QuestionDataSource, type QuestionPlanner } from "../bot/question";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough(); readonly stdout = new PassThrough(); readonly stderr = new PassThrough();
  readonly kill = vi.fn(); pid = 6612;
}
const waitFor = async (condition: () => boolean): Promise<void> => { for (let index = 0; index < 100; index += 1) { if (condition()) return; await new Promise((resolveWait) => setTimeout(resolveWait, 1)); } throw new Error("timed out"); };

describe("database questions", () => {
  it("clasifica con el modelo elegido sin darle acceso de escritura ni ejecutar la pregunta", async () => {
    const child = new FakeChild(); const calls: { command: string; args: readonly string[] }[] = [];
    const spawn = ((command: string, args: readonly string[]) => { calls.push({ command, args }); return child; }) as unknown as ProcessSpawner;
    const planner = new CodexQuestionPlanner(1_000, spawn, async () => undefined);
    let stdin = ""; child.stdin.on("data", (chunk) => { stdin += String(chunk); });
    const pending = planner.plan({ taskId: "q-1", question: "cuántos pacientes hay", signal: new AbortController().signal, selection: { model: "gpt-5.6-luna", reasoning: "low" } });
    await waitFor(() => calls.length === 1);
    const output = String(calls[0].args[calls[0].args.indexOf("--output-last-message") + 1]);
    await writeFile(output, JSON.stringify({ taskId: "q-1", metric: "PATIENT_TOTAL" })); child.emit("close", 0, null);
    await expect(pending).resolves.toEqual({ taskId: "q-1", metric: "PATIENT_TOTAL" });
    expect(calls[0].args).toEqual(expect.arrayContaining(["--model", "gpt-5.6-luna", "--config", "model_reasoning_effort=\"low\"", "--sandbox", "read-only", "--output-schema", QUESTION_PLAN_SCHEMA]));
    expect(stdin).toContain("No uses herramientas, no leas archivos, no ejecutes comandos");
    expect(stdin).toContain("BEGIN UNTRUSTED QUESTION");
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("valida un plan cerrado y ejecuta solamente métricas agregadas predefinidas", async () => {
    expect(validateQuestionPlan({ taskId: "q-1", metric: "PATIENT_TOTAL" }, "q-1")).toEqual({ taskId: "q-1", metric: "PATIENT_TOTAL" });
    expect(validateQuestionPlan({ taskId: "q-1", metric: "RAW_SQL" }, "q-1")).toBeNull();
    const planner: QuestionPlanner = { plan: async (input) => ({ taskId: input.taskId, metric: "PATIENTS_WITH_APPOINTMENTS_TODAY" }) };
    const calls: { start?: Date; end?: Date } = {};
    const data: QuestionDataSource = {
      patientTotal: async () => 3,
      patientsWithAppointments: async (start, end) => { calls.start = start; calls.end = end; return 2; },
      appointments: async () => 2,
      specialistTotal: async () => 4,
      availableSlots: async () => 5,
      futureAppointments: async () => 1,
    };
    const answerer = new DatabaseQuestionAnswerer(planner, data);
    await expect(answerer.answer({ taskId: "q-2", question: "pacientes con turnos hoy", signal: new AbortController().signal, selection: { model: "gpt-5.6-terra", reasoning: "medium" }, now: new Date("2026-08-13T12:00:00.000Z") })).resolves.toMatchObject({ status: "COMPLETED", answer: "2 pacientes tienen turnos reservados hoy (13/08/2026)." });
    expect(calls.start?.toISOString()).toBe("2026-08-13T03:00:00.000Z");
    expect(calls.end?.toISOString()).toBe("2026-08-14T03:00:00.000Z");
  });

  it("calcula el día de Buenos Aires de forma determinista", () => {
    expect(buenosAiresDay(new Date("2026-08-13T01:30:00.000Z")).label).toBe("12/08/2026");
  });
});
