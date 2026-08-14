import { describe, expect, it, vi } from "vitest";
import { SafeBot, hashChatId, type Executor, type ExecutorResult, type Messenger, type Run, type RunPatch, type RunStatus, type RunStore } from "../bot/core";

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

type PendingExecution = { input: { taskId: string; prompt: string; signal: AbortSignal }; resolve: (result: ExecutorResult) => void; reject: (reason: Error) => void };
class ControlledExecutor implements Executor {
  readonly calls: { taskId: string; prompt: string; signal: AbortSignal }[] = [];
  readonly pending = new Map<string, PendingExecution>();
  active = 0;
  maxActive = 0;

  run(input: { taskId: string; prompt: string; signal: AbortSignal }): Promise<ExecutorResult> {
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

const flush = async (): Promise<void> => { for (let index = 0; index < 30; index += 1) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; }); return { promise, resolve }; };
const waitForCall = async (executor: ControlledExecutor, count: number): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (executor.calls.length >= count) return;
    await Promise.resolve();
  }
  throw new Error(`Expected ${count} executor calls, got ${executor.calls.length}`);
};

const setup = (options?: { now?: () => Date; ttlMs?: number; maxMessage?: number; onFatal?: () => void }) => {
  const store = new MemoryStore();
  const messenger = new MemoryMessenger();
  const executor = new ControlledExecutor();
  const bot = new SafeBot("chat-a", store, messenger, executor, options?.now, options?.ttlMs, undefined, options?.maxMessage, undefined, options?.onFatal);
  return { bot, store, messenger, executor };
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

  it("notifica el progreso fijo al iniciar", async () => {
    const { bot, messenger, executor } = setup();
    await prompt(bot, "one"); await confirm(bot, "one"); await waitForCall(executor, 1);
    expect(messenger.sent.at(-1)).toMatchObject({ chatId: "chat-a", text: "Ejecución local iniciada." });
    executor.finish("tg-one"); await bot.waitForIdle();
  });

  it("envía una salida determinista con conteos y sin textos del executor", async () => {
    const { bot, store, messenger, executor } = setup();
    await prompt(bot, "one"); await confirm(bot, "one"); await waitForCall(executor, 1);
    executor.finishResult("tg-one", {
      taskId: "tg-one",
      status: "COMPLETED",
      summary: "SENTINEL_SUMMARY_SECRET",
      filesChanged: ["C:\\Users\\Private\\SENTINEL_FILE", "SENTINEL_FILE_TWO"],
      testsRun: ["SENTINEL_TEST_ONE", "SENTINEL_TEST_TWO", "SENTINEL_TEST_THREE"],
      testsPassed: true,
      warnings: ["SENTINEL_WARNING"],
      notionLogRequested: false,
    });
    await bot.waitForIdle();
    const message = messenger.sent.at(-1)?.text ?? "";
    expect(message).toBe("Estado: completado. Archivos modificados: 2. Verificaciones: 3; tests: aprobados. Advertencias: 1.");
    expect(message).not.toContain("SENTINEL");
    expect(store.runs.get("tg-one")?.verificationSummary).toBe(message);
    expect(store.runs.get("tg-one")?.verificationSummary).not.toContain("SENTINEL");
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
