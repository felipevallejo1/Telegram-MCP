import { createHash } from "node:crypto";

export type RunStatus = "PENDING" | "CONFIRMED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type Run = {
  id: string;
  updateId: string;
  chatHash: string;
  prompt: string;
  status: RunStatus;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  verificationSummary?: string;
};
export type ExecutorResult = { taskId: string; status: "COMPLETED" | "FAILED"; summary: string; filesChanged: string[]; testsRun: string[]; testsPassed: boolean; warnings: string[]; notionLogRequested: boolean };
export interface Executor { run(input: { taskId: string; prompt: string; signal: AbortSignal }): Promise<ExecutorResult>; }
export interface DiffProvider { get(): Promise<string>; }
export type RunPatch = Pick<Run, "startedAt" | "finishedAt" | "verificationSummary">;
export interface RunStore {
  create(run: Run): Promise<"created" | "duplicate">;
  get(id: string): Promise<Run | null>;
  transition(id: string, from: RunStatus, to: RunStatus, patch?: Partial<RunPatch>): Promise<boolean>;
  findLatestForChat(chatHash: string, statuses: RunStatus[]): Promise<Run | null>;
  findByStatuses(statuses: RunStatus[]): Promise<Run[]>;
}
export interface Messenger { send(chatId: string, text: string, buttons?: { text: string; data: string }[][]): Promise<void>; answerCallback(id: string, text?: string): Promise<void>; }
export type BotEvent = { updateId: string; chatId: string; text?: string; callbackId?: string; callbackData?: string };

const forbidden = /(?:\brm\b|remove-item|del\s+\/|rmdir\b|borr(?:a|á|e)\s+(?:todo|el\s+(?:repo|repositorio|proyecto))|elimin(?:a|á|ar)\s+(?:todo|el\s+(?:repo|repositorio|proyecto))|(?:delete|remove|erase)\s+(?:all|the\s+(?:repo|repository|project))|(?:powershell|cmd(?:\.exe)?|bash|zsh)\b|(?:shell|terminal)\s+(?:command|comando)|(?:comando\s+(?:arbitrario|arbitrary))|(?:run|ejecuta|ejecutá)\s+(?:a\s+)?(?:command|comando)|secret|token|api[ _-]?key|password|\.env\b|\bpush\b|deploy|publish|publica(?:r|ción)?|global\s+config|configuraci[oó]n\s+global|outside.{0,30}(?:project|repo)|fuera\s+(?:del\s+)?(?:proyecto|repo)|[A-Za-z]:[\\/]|\\\\|(?:^|[\s"'`])\/[A-Za-z0-9._-]+)/i;
export const normalizePrompt = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
export const hashChatId = (id: string) => createHash("sha256").update(id).digest("hex");
export const truncateTelegram = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
export const unavailableExecutor: Executor = {
  async run(input) {
    return { taskId: input.taskId, status: "FAILED", summary: "runner no configurado", filesChanged: [], testsRun: [], testsPassed: false, warnings: [], notionLogRequested: false };
  },
};

export class SafeBot {
  private queue: string[] = [];
  private queued = new Set<string>();
  private running: { id: string; chatHash: string; abort: AbortController } | null = null;
  private pumpPromise: Promise<void> | null = null;
  private destinations = new Map<string, string>();
  private closing = false;
  private fatal = false;

  constructor(
    private readonly allowedChatId: string | undefined,
    private readonly store: RunStore,
    private readonly messenger: Messenger,
    private readonly executor: Executor = unavailableExecutor,
    private readonly now = () => new Date(),
    private readonly ttlMs = 300000,
    private readonly maxPrompt = 1200,
    private readonly maxMessage = 3500,
    private readonly diffProvider?: DiffProvider,
    private readonly onFatal?: () => void,
  ) {}

  async handle(event: BotEvent): Promise<void> {
    if (this.fatal) throw new Error("Bot local unavailable.");
    if (this.closing) {
      if (event.callbackData) await this.messenger.answerCallback(event.callbackId ?? "", "Acción no disponible.");
      return;
    }
    if (!this.allowedChatId) {
      if (event.callbackData) await this.messenger.answerCallback(event.callbackId ?? "", "Acción no disponible.");
      else if (event.text === "/start") await this.messenger.send(event.chatId, `Configuración local pendiente. Este chat id es: ${event.chatId}`);
      return;
    }
    if (event.chatId !== this.allowedChatId) {
      if (event.callbackData) await this.messenger.answerCallback(event.callbackId ?? "", "Acción no disponible.");
      else await this.messenger.send(event.chatId, "No autorizado.");
      return;
    }
    if (event.callbackData) return this.callback(event);

    const text = event.text ?? "";
    if (text === "/start" || text === "/help") return this.messenger.send(event.chatId, "Comandos: /status, /prompt <pedido>, /diff, /cancel.");
    if (text === "/status") return this.messenger.send(event.chatId, `Estado: ${this.running ? "ejecutando" : "libre"}. Cola: ${this.queued.size}.`);
    if (text === "/diff") return this.sendDiff(event.chatId);
    if (text === "/cancel") return this.cancel(event.chatId);
    if (!text.startsWith("/prompt")) return;

    const prompt = normalizePrompt(text.slice(7));
    if (!prompt || prompt.length > this.maxPrompt || forbidden.test(prompt)) {
      return this.messenger.send(event.chatId, "Solicitud rechazada por la política local.");
    }
    const id = `tg-${event.updateId}`;
    const run: Run = { id, updateId: event.updateId, chatHash: hashChatId(event.chatId), prompt, status: "PENDING", createdAt: this.now() };
    if (await this.store.create(run) === "duplicate") {
      const existing = await this.store.get(id);
      if (!existing || existing.id !== id || existing.updateId !== run.updateId || existing.chatHash !== run.chatHash || existing.prompt !== run.prompt || existing.status !== "PENDING") return;
    }
    this.destinations.set(id, event.chatId);
    await this.messenger.send(event.chatId, truncateTelegram(`Vista previa: ${prompt}`, this.maxMessage), [[{ text: "Ejecutar", data: `run:${id}` }, { text: "Cancelar", data: `cancel:${id}` }]]);
  }

  async waitForIdle(): Promise<void> {
    while (this.pumpPromise) await this.pumpPromise;
  }

  async recoverInterrupted(): Promise<void> {
    if (this.closing || this.fatal) throw new Error("Bot local unavailable.");
    const runs = await this.store.findByStatuses(["RUNNING", "CONFIRMED"]);
    for (const run of runs) {
      if (run.status === "RUNNING") await this.store.transition(run.id, "RUNNING", "FAILED", { finishedAt: this.now(), verificationSummary: "Ejecución interrumpida antes de completar." });
      if (run.status === "CONFIRMED") await this.store.transition(run.id, "CONFIRMED", "CANCELLED", { finishedAt: this.now() });
    }
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    if (this.running) this.running.abort.abort();
    const queuedIds = [...this.queue];
    this.queue = [];
    this.queued.clear();
    for (const id of queuedIds) {
      const run = await this.store.get(id);
      if (run && (run.status === "PENDING" || run.status === "CONFIRMED")) {
        await this.store.transition(id, run.status, "CANCELLED", { finishedAt: this.now() });
        this.destinations.delete(id);
      }
    }
    await this.waitForIdle();
  }

  private async callback(event: BotEvent): Promise<void> {
    await this.messenger.answerCallback(event.callbackId ?? "");
    const [action, id] = event.callbackData!.split(":", 2);
    if (!id || (action !== "run" && action !== "cancel")) return;

    const run = await this.store.get(id);
    if (!run || run.chatHash !== hashChatId(event.chatId)) return;

    if (action === "cancel") {
      if (await this.cancelRun(run)) await this.sendTerminalTo(event.chatId, id, "Estado: cancelado.");
      return;
    }

    if (run.status !== "PENDING") return;
    if (this.now().getTime() - run.createdAt.getTime() > this.ttlMs) {
      await this.store.transition(id, "PENDING", "CANCELLED", { finishedAt: this.now() });
      this.destinations.delete(id);
      await this.sendTerminalTo(event.chatId, id, "Estado: cancelado.");
      return;
    }
    if (!(await this.store.transition(id, "PENDING", "CONFIRMED"))) return;
    this.destinations.set(id, event.chatId);
    this.enqueue(id);
  }

  private enqueue(id: string): void {
    if (this.closing) return;
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    this.schedulePump();
  }

  private schedulePump(): void {
    if (this.pumpPromise) return;
    this.pumpPromise = this.pump().catch(() => {
      this.fatal = true;
      this.closing = true;
      this.running?.abort.abort();
      this.queue = [];
      this.queued.clear();
      this.destinations.clear();
      try { this.onFatal?.(); } catch { /* Fatal lifecycle propagation is best effort. */ }
    }).finally(() => {
      this.pumpPromise = null;
      if (!this.closing && this.queue.length > 0) this.schedulePump();
    });
  }

  private async pump(): Promise<void> {
    while (this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) continue;
      this.queued.delete(id);
      await this.executeQueued(id);
    }
  }

  private async executeQueued(id: string): Promise<void> {
    if (this.closing) {
      const pending = await this.store.get(id);
      if (pending && pending.status === "CONFIRMED") await this.store.transition(id, "CONFIRMED", "CANCELLED", { finishedAt: this.now() });
      this.destinations.delete(id);
      return;
    }
    const run = await this.store.get(id);
    if (this.closing) {
      if (run && (run.status === "PENDING" || run.status === "CONFIRMED")) await this.store.transition(id, run.status, "CANCELLED", { finishedAt: this.now() });
      this.destinations.delete(id);
      return;
    }
    if (!run || run.status !== "CONFIRMED") return;

    const abort = new AbortController();
    if (!(await this.store.transition(id, "CONFIRMED", "RUNNING", { startedAt: this.now() }))) return;
    if (this.closing) {
      await this.store.transition(id, "RUNNING", "CANCELLED", { finishedAt: this.now() });
      this.destinations.delete(id);
      return;
    }
    this.running = { id, chatHash: run.chatHash, abort };
    await this.sendProgress(id);
    try {
      const result = await this.executor.run({ taskId: id, prompt: run.prompt, signal: abort.signal });
      if (abort.signal.aborted) {
        await this.store.transition(id, "RUNNING", "CANCELLED", { finishedAt: this.now() });
        await this.sendTerminal(id, "Estado: cancelado.");
        return;
      }
      const terminalMessage = this.resultMessage(result);
      await this.store.transition(id, "RUNNING", result.status, { finishedAt: this.now(), verificationSummary: terminalMessage });
      await this.sendTerminal(id, terminalMessage);
    } catch {
      if (abort.signal.aborted) {
        await this.store.transition(id, "RUNNING", "CANCELLED", { finishedAt: this.now() });
        await this.sendTerminal(id, "Estado: cancelado.");
      } else {
        await this.store.transition(id, "RUNNING", "FAILED", { finishedAt: this.now(), verificationSummary: "La ejecución local falló." });
        await this.sendTerminal(id, "Estado: fallido. La ejecución local no pudo completarse.");
      }
    } finally {
      this.running = null;
      this.destinations.delete(id);
    }
  }

  private async cancelRun(run: Run): Promise<boolean> {
    if (run.status !== "PENDING" && run.status !== "CONFIRMED") return false;
    const cancelled = await this.store.transition(run.id, run.status, "CANCELLED", { finishedAt: this.now() });
    if (cancelled) {
      this.queued.delete(run.id);
      this.destinations.delete(run.id);
    }
    return cancelled;
  }

  private async cancel(chatId: string): Promise<void> {
    const chatHash = hashChatId(chatId);
    const queuedRun = await this.store.findLatestForChat(chatHash, ["PENDING", "CONFIRMED"]);
    if (queuedRun && await this.cancelRun(queuedRun)) {
      await this.sendTerminalTo(chatId, queuedRun.id, "Estado: cancelado.");
      return;
    }
    if (this.running?.chatHash === chatHash) {
      this.running.abort.abort();
      await this.messenger.send(chatId, "Cancelación solicitada.");
      return;
    }
    await this.messenger.send(chatId, "No hay ejecución activa.");
  }

  private async sendProgress(id: string): Promise<void> {
    const chatId = this.destinations.get(id);
    if (chatId) await this.sendSafely(chatId, "Ejecución local iniciada.");
  }

  private async sendDiff(chatId: string): Promise<void> {
    if (!this.diffProvider) {
      await this.messenger.send(chatId, "Diff no disponible.");
      return;
    }
    try {
      const diff = normalizePrompt(await this.diffProvider.get());
      await this.messenger.send(chatId, truncateTelegram(diff || "No hay cambios locales.", this.maxMessage));
    } catch {
      await this.messenger.send(chatId, "No se pudo obtener el diff local.");
    }
  }

  private async sendTerminal(id: string, text: string): Promise<void> {
    const chatId = this.destinations.get(id);
    if (chatId) await this.sendSafely(chatId, truncateTelegram(text, this.maxMessage));
  }

  private async sendTerminalTo(chatId: string, id: string, text: string): Promise<void> {
    await this.sendSafely(chatId, truncateTelegram(text, this.maxMessage));
    this.destinations.delete(id);
  }

  private async sendSafely(chatId: string, text: string): Promise<void> {
    try {
      await this.messenger.send(chatId, text);
    } catch {
      // Notifications do not alter the authoritative run state.
    }
  }

  private resultMessage(result: ExecutorResult): string {
    const status = result.status === "COMPLETED" ? "completado" : "fallido";
    const tests = result.testsPassed ? "aprobados" : "fallidos";
    return `Estado: ${status}. Archivos modificados: ${result.filesChanged.length}. Verificaciones: ${result.testsRun.length}; tests: ${tests}. Advertencias: ${result.warnings.length}.`;
  }
}
