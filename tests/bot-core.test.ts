import { describe, expect, it, vi } from "vitest";
import { SafeBot, hashChatId, type DocumentationResult, type Documenter, type Executor, type ExecutorResult, type Messenger, type QuestionAnswerer, type QuestionResult, type Run, type RunPatch, type RunStatus, type RunStore } from "../bot/core";

class MemoryStore implements RunStore {
  readonly runs = new Map<string, Run>();

  async create(run: Run): Promise<"created" | "duplicate"> {
    if (this.runs.has(run.id)) return "duplicate";
    this.runs.set(run.id, { ...run });
    return "created";
  }

  async get(id: string): Promise<Run | null> {
    return this.runs.get(id) ?? null;
  }

  async transition(id: string, from: RunStatus, to: RunStatus, patch?: Partial<RunPatch>): Promise<boolean> {
    const run = this.runs.get(id);
    if (!run || run.status !== from) return false;
    Object.assign(run, patch, { status: to });
    return true;
  }

  async findLatestForChat(chatHash: string, statuses: RunStatus[]): Promise<Run | null> {
    return [...this.runs.values()]
      .filter((run) => run.chatHash === chatHash && statuses.includes(run.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  }
  async findByStatuses(statuses: RunStatus[]): Promise<Run[]> {
    return [...this.runs.values()].filter((run) => statuses.includes(run.status)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async updateNotion(id: string, notionStatus: "PENDING" | "SYNCED" | "FAILED", notionUrl?: string): Promise<boolean> {
    const run = this.runs.get(id);
    if (!run) return false;
    run.notionStatus = notionStatus;
    run.notionUrl = notionUrl;
    return true;
  }
}

class MemoryMessenger implements Messenger {
  readonly sent: { chatId: string; text: string; buttons?: { text: string; data: string }[][] }[] = [];
  readonly callbacks: { id: string; text?: string }[] = [];

  async send(chatId: string, text: string, buttons?: { text: string; data: string }[][]): Promise<void> {
    this.sent.push({ chatId, text, buttons });
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    this.callbacks.push({ id, text });
  }
}

type ExecutionInput = Parameters<Executor["run"]>[0];
type PendingExecution = { input: ExecutionInput; resolve: (result: ExecutorResult) => void; reject: (reason: Error) => void };
class ControlledExecutor implements Executor {
  readonly calls: ExecutionInput[] = [];
  readonly pending = new Map<string, PendingExecution>();
  active = 0;
  maxActive = 0;

  run(input: ExecutionInput): Promise<ExecutorResult> {
    this.calls.push(input);
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<ExecutorResult>((resolve, reject) => {
      this.pending.set(input.taskId, {
        input,
        resolve: (result) => { this.active -= 1; resolve(result); },
        reject: (reason) => { this.active -= 1; reject(reason); },
      });
    });
  }

  finish(id: string, status: "COMPLETED" | "FAILED" = "COMPLETED", summary = "resultado"): void {
    this.finishResult(id, { taskId: id, status, summary, filesChanged: [], testsRun: [], testsPassed: status === "COMPLETED", warnings: [], notionLogRequested: false });
  }

  finishResult(id: string, result: ExecutorResult): void {
    const pending = this.pending.get(id);
    if (!pending) throw new Error(`Missing execution ${id}`);
    this.pending.delete(id);
    pending.resolve(result);
  }

  fail(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) throw new Error(`Missing execution ${id}`);
    this.pending.delete(id);
    pending.reject(new Error("executor failed"));
  }
}

class ControlledDocumenter implements Documenter {
  readonly calls: Parameters<Documenter["document"]>[0][] = [];
  private pending?: { resolve: (result: DocumentationResult) => void; reject: (error: Error) => void };

  document(input: Parameters<Documenter["document"]>[0]): Promise<DocumentationResult> {
    this.calls.push(input);
    return new Promise((resolve, reject) => { this.pending = { resolve, reject }; });
  }

  finish(taskId: string, notionUrl = "https://www.notion.so/medicontrol-demo"): void {
    this.pending?.resolve({ taskId, status: "COMPLETED", notionUrl, summary: "documentado" });
    this.pending = undefined;
  }
}

class ControlledQuestionAnswerer implements QuestionAnswerer {
  readonly calls: Parameters<QuestionAnswerer["answer"]>[0][] = [];
  private pending?: { resolve: (result: QuestionResult) => void };
  answer(input: Parameters<QuestionAnswerer["answer"]>[0]): Promise<QuestionResult> {
    this.calls.push(input);
    return new Promise((resolve) => { this.pending = { resolve }; });
  }
  finish(taskId: string, answer = "Hay 3 pacientes registrados."): void {
    this.pending?.resolve({ taskId, status: "COMPLETED", answer });
    this.pending = undefined;
  }
}

const flush = async (): Promise<void> => { for (let index = 0; index < 30; index += 1) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; }); return { promise, resolve }; };
const waitForCall = async (executor: ControlledExecutor, count: number): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (executor.calls.length >= count) return;
    await Promise.resolve();
  }
  throw new Error(`Expected ${count} executor calls, got ${executor.calls.length}`);
};

const setup = (options?: { now?: () => Date; ttlMs?: number; maxMessage?: number; onFatal?: () => void; progressDelaysMs?: readonly number[]; documenter?: ControlledDocumenter; questionAnswerer?: ControlledQuestionAnswerer }) => {
  const store = new MemoryStore();
  const messenger = new MemoryMessenger();
  const executor = new ControlledExecutor();
  const bot = new SafeBot("chat-a", store, messenger, executor, options?.now, options?.ttlMs, undefined, options?.maxMessage, undefined, options?.onFatal, options?.progressDelaysMs, options?.documenter, options?.questionAnswerer);
  return { bot, store, messenger, executor, documenter: options?.documenter, questionAnswerer: options?.questionAnswerer };
};
const prompt = (bot: SafeBot, updateId: string, chatId = "chat-a", text = "orden segura") => bot.handle({ updateId, chatId, text: `/prompt ${text}` });
const confirm = (bot: SafeBot, updateId: string, chatId = "chat-a") => bot.handle({ updateId: `callback-${updateId}`, chatId, callbackId: `callback-${updateId}`, callbackData: `run:tg-${updateId}` });

describe("SafeBot", () => {
  it("responde callbacks no autorizados sin consultar el store ni ejecutar", async () => {
    const { bot, store, messenger, executor } = setup();
    await bot.handle({ updateId: "u", chatId: "other", callbackId: "cb", callbackData: "run:tg-u" });
    expect(messenger.callbacks).toEqual([{ id: "cb", text: "Acción no disponible." }]);
    expect(store.runs.size).toBe(0);
    expect(executor.calls).toHaveLength(0);
  });

  it("no ejecuta antes de confirmar", async () => {
    const { bot, store, executor } = setup();
    await prompt(bot, "one");
    expect(store.runs.get("tg-one")?.status).toBe("PENDING");
    expect(executor.calls).toHaveLength(0);
  });

  it("notifica el inicio y el progreso periódico mientras Codex continúa trabajando", async () => {
    vi.useFakeTimers();
    const { bot, messenger, executor } = setup({ progressDelaysMs: [1_000, 2_000] });
    await prompt(bot, "one"); await confirm(bot, "one"); await waitForCall(executor, 1);
    expect(messenger.sent.at(-1)).toMatchObject({ chatId: "chat-a", text: "🔍 Analizando el proyecto…" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(messenger.sent.at(-1)?.text).toContain("Codex sigue trabajando");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(messenger.sent.at(-1)?.text).toContain("La ejecución continúa");
    executor.finish("tg-one"); await bot.waitForIdle();
    const sentAfterFinish = messenger.sent.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(messenger.sent).toHaveLength(sentAfterFinish);
    vi.useRealTimers();
  });

  it("muestra el resumen, las verificaciones y cada advertencia segura", async () => {
    const { bot, store, messenger, executor } = setup();
    await prompt(bot, "one"); await confirm(bot, "one"); await waitForCall(executor, 1);
    executor.finishResult("tg-one", {
      taskId: "tg-one",
      status: "COMPLETED",
      summary: "Cambio visual aplicado.",
      filesChanged: ["src/app/globals.css"],
      testsRun: ["npm.cmd run test", "npm.cmd run lint"],
      testsPassed: true,
      warnings: ["El repositorio ya tenía cambios locales."],
      notionLogRequested: false,
    });
    await bot.waitForIdle();
    const message = messenger.sent.at(-1)?.text ?? "";
    expect(message).toContain("Estado: completado con advertencias.");
    expect(message).toContain("Resumen: Cambio visual aplicado.");
    expect(message).toContain("- El repositorio ya tenía cambios locales.");
    expect(message).toContain("- src/app/globals.css");
    expect(message).toContain("- npm.cmd run test");
    expect(store.runs.get("tg-one")?.verificationSummary).toBe(message);
    expect(store.runs.get("tg-one")?.status).toBe("COMPLETED");
  });

  it("no marca completada una tarea cuyas verificaciones fallaron", async () => {
    const { bot, store, messenger, executor } = setup();
    await prompt(bot, "failed-tests"); await confirm(bot, "failed-tests"); await waitForCall(executor, 1);
    executor.finishResult("tg-failed-tests", { taskId: "tg-failed-tests", status: "COMPLETED", summary: "Cambio aplicado.", filesChanged: ["src/app/page.tsx"], testsRun: ["npm.cmd run test"], testsPassed: false, warnings: ["Una verificación no pasó."], notionLogRequested: false });
    await bot.waitForIdle();
    expect(store.runs.get("tg-failed-tests")?.status).toBe("FAILED");
    expect(messenger.sent.at(-1)?.text).toContain("cambio aplicado, pero verificación fallida");
    expect(messenger.sent.at(-1)?.text).toContain("Una verificación no pasó");
  });

  it("permite elegir modelo y razonamiento y conserva la selección para la tarea", async () => {
    const { bot, messenger, executor } = setup();
    await bot.handle({ updateId: "models", chatId: "chat-a", text: "/modelo" });
    expect(messenger.sent.at(-1)?.text).toContain("Modelo: Terra · razonamiento: medium");
    await bot.handle({ updateId: "model-luna", chatId: "chat-a", callbackId: "model-luna", callbackData: "model:luna" });
    await bot.handle({ updateId: "effort-low", chatId: "chat-a", callbackId: "effort-low", callbackData: "effort:low" });
    await prompt(bot, "selected");
    expect(messenger.sent.at(-1)?.text).toContain("Modelo: Luna · razonamiento: low");
    await confirm(bot, "selected"); await waitForCall(executor, 1);
    expect(executor.calls[0].selection).toEqual({ model: "gpt-5.6-luna", reasoning: "low" });
    executor.finish("tg-selected"); await bot.waitForIdle();
  });

  it("responde /pregunta mediante el lector agregado sin modificar el proyecto", async () => {
    const questionAnswerer = new ControlledQuestionAnswerer();
    const { bot, messenger } = setup({ questionAnswerer, now: () => new Date("2026-08-13T12:00:00.000Z") });
    await bot.handle({ updateId: "question", chatId: "chat-a", text: "/pregunta cuántos pacientes hay registrados" });
    expect(questionAnswerer.calls).toHaveLength(1);
    expect(questionAnswerer.calls[0]).toMatchObject({ taskId: "q-question", question: "cuántos pacientes hay registrados", selection: { model: "gpt-5.6-terra", reasoning: "medium" } });
    expect(messenger.sent.at(-1)?.text).toContain("solo lectura");
    questionAnswerer.finish("q-question"); await bot.waitForIdle();
    expect(messenger.sent.at(-1)?.text).toBe("Resultado: Hay 3 pacientes registrados.");
  });

  it("documenta solo después de /documentar y de una confirmación explícita", async () => {
    const documenter = new ControlledDocumenter();
    const { bot, store, messenger, executor } = setup({ documenter });
    await prompt(bot, "one"); await confirm(bot, "one"); await waitForCall(executor, 1);
    executor.finish("tg-one"); await bot.waitForIdle();
    expect(documenter.calls).toHaveLength(0);

    await bot.handle({ updateId: "doc-preview", chatId: "chat-a", text: "/documentar" });
    expect(documenter.calls).toHaveLength(0);
    expect(messenger.sent.at(-1)?.text).toContain("Esta acción no es automática");
    expect(messenger.sent.at(-1)?.buttons?.[0]?.[0]).toEqual({ text: "Documentar en Notion", data: "document:tg-one" });

    await bot.handle({ updateId: "doc-confirm", chatId: "chat-a", callbackId: "doc-confirm", callbackData: "document:tg-one" });
    expect(documenter.calls).toHaveLength(1);
    expect(messenger.sent.at(-1)?.text).toContain("pedido y confirmación del usuario");
    documenter.finish("tg-one"); await bot.waitForIdle();
    expect(store.runs.get("tg-one")).toMatchObject({ notionStatus: "SYNCED", notionUrl: "https://www.notion.so/medicontrol-demo" });
    expect(messenger.sent.at(-1)?.text).toContain("Documentación creada en Notion");
  });

  it("acepta un pedido explícito en lenguaje natural o un comando con nombre del bot", async () => {
    const documenter = new ControlledDocumenter();
    const { bot, store, messenger } = setup({ documenter });
    await store.create({ id: "done", updateId: "done", chatHash: hashChatId("chat-a"), prompt: "cambio", status: "COMPLETED", createdAt: new Date(), notionStatus: "PENDING" });
    await bot.handle({ updateId: "natural", chatId: "chat-a", text: "Documentalo en Notion" });
    expect(messenger.sent.at(-1)?.buttons?.[0]?.[0]).toEqual({ text: "Documentar en Notion", data: "document:done" });
    expect(messenger.sent.at(-1)?.text).toContain("Cambio");
    expect(messenger.sent.at(-1)?.text).not.toContain("done");
    await bot.handle({ updateId: "mention", chatId: "chat-a", text: "/documentar@MediControlRemoteBot" });
    expect(messenger.sent.at(-1)?.text).toContain("Documentar en Notion");
    expect(documenter.calls).toHaveLength(0);
  });

  it("muestra una descripción breve del cambio en vez del identificador técnico", async () => {
    const documenter = new ControlledDocumenter();
    const { bot, store, messenger } = setup({ documenter });
    await store.create({ id: "tg-12345678901234567890", updateId: "long", chatHash: hashChatId("chat-a"), prompt: "cambiar el color secundario de toda la página a rojo", status: "COMPLETED", createdAt: new Date(), notionStatus: "PENDING" });
    await bot.handle({ updateId: "document", chatId: "chat-a", text: "/documentar" });
    const preview = messenger.sent.at(-1)?.text ?? "";
    expect(preview).toContain("Cambiar el color secundario de toda la página a rojo");
    expect(preview).not.toContain("tg-12345678901234567890");
  });

  it("responde en lugar de ignorar silenciosamente un texto desconocido", async () => {
    const { bot, messenger } = setup();
    await bot.handle({ updateId: "unknown", chatId: "chat-a", text: "hola" });
    expect(messenger.sent.at(-1)?.text).toContain("No reconocí");
  });

  it("no ofrece Notion sin un cambio completado ni vuelve a duplicar uno sincronizado", async () => {
    const documenter = new ControlledDocumenter();
    const { bot, store, messenger } = setup({ documenter });
    await bot.handle({ updateId: "empty", chatId: "chat-a", text: "/documentar" });
    expect(messenger.sent.at(-1)?.text).toContain("No hay un cambio completado");
    await store.create({ id: "done", updateId: "done", chatHash: hashChatId("chat-a"), prompt: "cambio", status: "COMPLETED", createdAt: new Date(), notionStatus: "SYNCED", notionUrl: "https://www.notion.so/already" });
    await bot.handle({ updateId: "again", chatId: "chat-a", text: "/documentar" });
    expect(messenger.sent.at(-1)?.text).toContain("ya está documentado");
    expect(documenter.calls).toHaveLength(0);
  });

  it("ignora el replay de confirmación", async () => {
    const { bot, store, executor } = setup();
    await prompt(bot, "one");
    await confirm(bot, "one");
    await waitForCall(executor, 1);
    await confirm(bot, "one");
    expect(executor.calls).toHaveLength(1);
    executor.finish("tg-one");
    await bot.waitForIdle();
    expect(store.runs.get("tg-one")?.status).toBe("COMPLETED");
  });

  it("vence un pendiente y lo deja terminal", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const { bot, store, executor } = setup({ now: () => new Date(createdAt.getTime() + 301000), ttlMs: 300000 });
    await store.create({ id: "tg-old", updateId: "old", chatHash: hashChatId("chat-a"), prompt: "segura", status: "PENDING", createdAt });
    await confirm(bot, "old");
    expect(store.runs.get("tg-old")?.status).toBe("CANCELLED");
    expect(store.runs.get("tg-old")?.finishedAt).toBeInstanceOf(Date);
    expect(executor.calls).toHaveLength(0);
  });

  it("drena dos confirmadas en FIFO", async () => {
    const { bot, store, executor } = setup();
    await prompt(bot, "one"); await prompt(bot, "two");
    await confirm(bot, "one"); await waitForCall(executor, 1);
    await confirm(bot, "two");
    expect(executor.calls.map((call) => call.taskId)).toEqual(["tg-one"]);
    executor.finish("tg-one");
    await waitForCall(executor, 2);
    expect(executor.calls.map((call) => call.taskId)).toEqual(["tg-one", "tg-two"]);
    executor.finish("tg-two");
    await bot.waitForIdle();
    expect([store.runs.get("tg-one")?.status, store.runs.get("tg-two")?.status]).toEqual(["COMPLETED", "COMPLETED"]);
  });

  it("mantiene concurrencia máxima de uno", async () => {
    const { bot, executor } = setup();
    await prompt(bot, "one"); await prompt(bot, "two");
    await confirm(bot, "one"); await waitForCall(executor, 1);
    await confirm(bot, "two"); await flush();
    expect(executor.maxActive).toBe(1);
    executor.finish("tg-one"); await waitForCall(executor, 2);
    expect(executor.maxActive).toBe(1);
    executor.finish("tg-two"); await bot.waitForIdle();
  });

  it("cancela una solicitud pendiente", async () => {
    const { bot, store, executor } = setup();
    await prompt(bot, "one");
    await bot.handle({ updateId: "cancel", chatId: "chat-a", text: "/cancel" });
    expect(store.runs.get("tg-one")?.status).toBe("CANCELLED");
    expect(executor.calls).toHaveLength(0);
  });

  it("cancela una confirmada que espera en cola", async () => {
    const { bot, store, executor } = setup();
    await prompt(bot, "one"); await prompt(bot, "two");
    await confirm(bot, "one"); await waitForCall(executor, 1);
    await confirm(bot, "two");
    await bot.handle({ updateId: "cancel", chatId: "chat-a", text: "/cancel" });
    expect(store.runs.get("tg-two")?.status).toBe("CANCELLED");
    executor.finish("tg-one"); await bot.waitForIdle();
    expect(executor.calls).toHaveLength(1);
  });

  it("cancela una ejecución en curso aunque el executor resuelva", async () => {
    const { bot, store, messenger, executor } = setup();
    await prompt(bot, "one"); await confirm(bot, "one"); await waitForCall(executor, 1);
    await bot.handle({ updateId: "cancel", chatId: "chat-a", text: "/cancel" });
    expect(executor.calls[0].signal.aborted).toBe(true);
    executor.finish("tg-one"); await bot.waitForIdle();
    expect(store.runs.get("tg-one")?.status).toBe("CANCELLED");
    expect(messenger.sent.at(-1)).toMatchObject({ chatId: "chat-a", text: "Estado: cancelado." });
  });

  it("marca FAILED si el executor falla sin cancelación", async () => {
    const { bot, store, messenger, executor } = setup();
    await prompt(bot, "one"); await confirm(bot, "one"); await waitForCall(executor, 1);
    executor.fail("tg-one"); await bot.waitForIdle();
    expect(store.runs.get("tg-one")?.status).toBe("FAILED");
    expect(store.runs.get("tg-one")?.finishedAt).toBeInstanceOf(Date);
    expect(messenger.sent.at(-1)).toMatchObject({ chatId: "chat-a", text: "Estado: fallido. La ejecución local no pudo completarse." });
  });

  it("trunca la vista previa para Telegram", async () => {
    const { bot, messenger } = setup({ maxMessage: 12 });
    await prompt(bot, "one", "chat-a", "una solicitud deliberadamente extensa");
    expect(messenger.sent[0].text).toHaveLength(12);
    expect(messenger.sent[0].text).toMatch(/…$/);
  });

  it("cancelar en un chat no afecta la solicitud de otro chat", async () => {
    const { bot, store } = setup();
    const createdAt = new Date();
    await store.create({ id: "tg-own", updateId: "own", chatHash: hashChatId("chat-a"), prompt: "propia", status: "PENDING", createdAt });
    await store.create({ id: "tg-other", updateId: "other", chatHash: hashChatId("chat-b"), prompt: "ajena", status: "PENDING", createdAt: new Date(createdAt.getTime() + 1) });
    await bot.handle({ updateId: "cancel", chatId: "chat-a", text: "/cancel" });
    expect(store.runs.get("tg-own")?.status).toBe("CANCELLED");
    expect(store.runs.get("tg-other")?.status).toBe("PENDING");
  });

  it("mantiene destinos efímeros separados entre tareas de chats distintos", async () => {
    const { bot, messenger, executor } = setup();
    await prompt(bot, "one", "chat-a"); await confirm(bot, "one", "chat-a"); await waitForCall(executor, 1);
    Reflect.set(bot, "allowedChatId", "chat-b");
    await prompt(bot, "two", "chat-b"); await confirm(bot, "two", "chat-b");
    executor.finish("tg-one"); await waitForCall(executor, 2);
    executor.finish("tg-two"); await bot.waitForIdle();

    const terminalMessages = messenger.sent.filter((message) => message.text.startsWith("Estado:"));
    expect(terminalMessages.map((message) => message.chatId)).toEqual(["chat-a", "chat-b"]);
    expect((Reflect.get(bot, "destinations") as Map<string, string>).size).toBe(0);
  });

  it("shutdown cancela la cola y aborta el trabajo en curso sin iniciar otro", async () => {
    const { bot, store, executor } = setup();
    await prompt(bot, "one"); await prompt(bot, "two");
    await confirm(bot, "one"); await waitForCall(executor, 1);
    await confirm(bot, "two");
    const stopping = bot.shutdown();
    expect(executor.calls[0].signal.aborted).toBe(true);
    executor.finish("tg-one"); await stopping;
    expect(executor.calls).toHaveLength(1);
    expect(store.runs.get("tg-one")?.status).toBe("CANCELLED");
    expect(store.runs.get("tg-two")?.status).toBe("CANCELLED");
  });

  it("rechaza solicitudes peligrosas en espanol e ingles antes de crear una vista previa", async () => {
    const { bot, store, messenger } = setup();
    const dangerous = ["borrá todo el repositorio", "leé C:\\Windows\\System32", "powershell Remove-Item", "cmd.exe /c del", "ejecutá un comando arbitrario", "push y deploy", "read .env token", "delete all repository", "/etc/passwd", "/opt/private"];
    for (const [index, text] of dangerous.entries()) await prompt(bot, `danger-${index}`, "chat-a", text);
    expect(store.runs.size).toBe(0);
    expect(messenger.sent).toHaveLength(dangerous.length);
    expect(messenger.sent.every((message) => message.text.includes("Solicitud rechazada"))).toBe(true);
  });

  it("permite una solicitud funcional legitima sobre un turno", async () => {
    const { bot, store } = setup();
    await prompt(bot, "legit", "chat-a", "cancelá el turno presencial/virtual ficticio de mañana");
    expect(store.runs.get("tg-legit")?.status).toBe("PENDING");
  });

  it("rechaza mensajes completos de un chat no autorizado", async () => {
    const { bot, store, messenger, executor } = setup();
    await bot.handle({ updateId: "blocked", chatId: "other", text: "/prompt cambio seguro" });
    expect(messenger.sent).toEqual([{ chatId: "other", text: "No autorizado." }]);
    expect(store.runs.size).toBe(0); expect(executor.calls).toHaveLength(0);
  });

  it("reintenta la vista previa para un update completo duplicado sin crear otro run", async () => {
    const { bot, store, messenger } = setup();
    const event = { updateId: "duplicate", chatId: "chat-a", text: "/prompt cambio seguro" };
    await bot.handle(event); await bot.handle(event);
    expect(store.runs.size).toBe(1); expect(messenger.sent).toHaveLength(2);
  });

  it("reenvia preview pendiente tras fallo de entrega sin duplicar ni ejecutar dos veces", async () => {
    const { bot, store, messenger, executor } = setup(); const originalSend = messenger.send.bind(messenger); let attempts = 0;
    messenger.send = async (chatId, text, buttons) => { attempts += 1; if (attempts === 1) throw new Error("delivery failed"); return originalSend(chatId, text, buttons); };
    const event = { updateId: "retry", chatId: "chat-a", text: "/prompt cambio seguro" };
    await expect(bot.handle(event)).rejects.toThrow("delivery failed");
    expect(store.runs.size).toBe(1); expect(store.runs.get("tg-retry")?.status).toBe("PENDING");
    await bot.handle(event); expect(messenger.sent).toHaveLength(1); expect(messenger.sent[0].buttons).toBeDefined();
    await confirm(bot, "retry"); await waitForCall(executor, 1); executor.finish("tg-retry"); await bot.waitForIdle();
    expect(executor.calls).toHaveLength(1);
  });

  it("cierra la cola sin rechazo no manejado cuando el store falla en el pump", async () => {
    const { bot, store, executor } = setup();
    await prompt(bot, "one"); await prompt(bot, "two");
    await confirm(bot, "one"); await waitForCall(executor, 1); await confirm(bot, "two");
    const originalGet = store.get.bind(store);
    store.get = async (id) => id === "tg-two" ? Promise.reject(new Error("store failure")) : originalGet(id);
    executor.finish("tg-one"); await bot.waitForIdle();
    expect(executor.calls).toHaveLength(1);
    expect((Reflect.get(bot, "queue") as string[])).toEqual([]);
    expect((Reflect.get(bot, "destinations") as Map<string, string>).size).toBe(0);
  });

  it("propaga fatal y rechaza eventos posteriores sin ejecutar", async () => {
    const onFatal = vi.fn(); const { bot, store, executor } = setup({ onFatal });
    await prompt(bot, "one"); await confirm(bot, "one"); await waitForCall(executor, 1);
    const originalTransition = store.transition.bind(store);
    store.transition = async (id, from, to, patch) => id === "tg-one" && from === "RUNNING" ? Promise.reject(new Error("store failure")) : originalTransition(id, from, to, patch);
    executor.finish("tg-one"); await bot.waitForIdle();
    expect(onFatal).toHaveBeenCalledOnce();
    await expect(bot.handle({ updateId: "later", chatId: "chat-a", text: "/status" })).rejects.toThrow("Bot local unavailable.");
    expect(executor.calls).toHaveLength(1);
  });

  it("no ejecuta si shutdown gana mientras el segundo get del pump esta diferido", async () => {
    const { bot, store, executor } = setup(); const originalGet = store.get.bind(store); const entered = deferred<void>(); const release = deferred<Run | null>(); let gets = 0;
    store.get = async (id) => { gets += 1; if (gets === 2) { entered.resolve(); return release.promise; } return originalGet(id); };
    await prompt(bot, "one"); await confirm(bot, "one"); await entered.promise;
    const stopping = bot.shutdown(); release.resolve(await originalGet("tg-one")); await stopping;
    expect(executor.calls).toHaveLength(0); expect(store.runs.get("tg-one")?.status).toBe("CANCELLED"); await bot.waitForIdle();
  });

  it("no ejecuta si shutdown gana mientras CONFIRMED a RUNNING esta diferido", async () => {
    const { bot, store, executor } = setup(); const originalTransition = store.transition.bind(store); const entered = deferred<void>(); const release = deferred<void>();
    store.transition = async (id, from, to, patch) => {
      if (id === "tg-one" && from === "CONFIRMED" && to === "RUNNING") { entered.resolve(); await release.promise; }
      return originalTransition(id, from, to, patch);
    };
    await prompt(bot, "one"); await confirm(bot, "one"); await entered.promise;
    const stopping = bot.shutdown(); release.resolve(); await stopping;
    expect(executor.calls).toHaveLength(0); expect(store.runs.get("tg-one")?.status).toBe("CANCELLED"); await bot.waitForIdle();
  });

  it("recupera runs interrumpidos de forma conservadora sin ejecutar Codex", async () => {
    const { bot, store, executor } = setup(); const created = new Date("2026-01-01T00:00:00.000Z");
    await store.create({ id: "old-running", updateId: "r", chatHash: "h", prompt: "safe", status: "RUNNING", createdAt: created });
    await store.create({ id: "old-confirmed", updateId: "c", chatHash: "h", prompt: "safe", status: "CONFIRMED", createdAt: new Date(created.getTime() + 1) });
    await bot.recoverInterrupted(); await bot.recoverInterrupted();
    expect(store.runs.get("old-running")).toMatchObject({ status: "FAILED", verificationSummary: "Ejecución interrumpida antes de completar." });
    expect(store.runs.get("old-confirmed")?.status).toBe("CANCELLED"); expect(executor.calls).toHaveLength(0);
  });

  it("propaga fallo de consulta de recuperacion sin ejecutar Codex", async () => {
    const { bot, store, executor } = setup(); store.findByStatuses = async () => Promise.reject(new Error("query failure"));
    await expect(bot.recoverInterrupted()).rejects.toThrow("query failure"); expect(executor.calls).toHaveLength(0);
  });
});
