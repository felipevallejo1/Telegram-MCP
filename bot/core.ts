import { createHash } from "node:crypto";
import { defaultModelSelection, isModelKey, isReasoningEffort, modelByKey, modelKeys, modelName, reasoningEfforts, type ModelSelection } from "./models";

export type RunStatus = "PENDING" | "CONFIRMED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type NotionStatus = "PENDING" | "SYNCED" | "FAILED";
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
  notionUrl?: string;
  notionStatus?: NotionStatus;
};
export type ExecutorResult = { taskId: string; status: "COMPLETED" | "FAILED"; summary: string; filesChanged: string[]; testsRun: string[]; testsPassed: boolean; warnings: string[]; notionLogRequested: boolean };
export interface Executor { run(input: { taskId: string; prompt: string; signal: AbortSignal; selection?: ModelSelection }): Promise<ExecutorResult>; }
export type DocumentationResult = { taskId: string; status: "COMPLETED" | "FAILED"; notionUrl: string; summary: string };
export interface Documenter { document(input: { run: Run; signal: AbortSignal; selection?: ModelSelection }): Promise<DocumentationResult>; }
export type QuestionResult = { taskId: string; status: "COMPLETED" | "FAILED"; answer: string; warning?: string };
export interface QuestionAnswerer { answer(input: { taskId: string; question: string; signal: AbortSignal; selection: ModelSelection; now: Date }): Promise<QuestionResult>; }
export interface DiffProvider { get(): Promise<string>; }
export type RunPatch = Pick<Run, "startedAt" | "finishedAt" | "verificationSummary">;
export interface RunStore {
  create(run: Run): Promise<"created" | "duplicate">;
  get(id: string): Promise<Run | null>;
  transition(id: string, from: RunStatus, to: RunStatus, patch?: Partial<RunPatch>): Promise<boolean>;
  findLatestForChat(chatHash: string, statuses: RunStatus[]): Promise<Run | null>;
  findByStatuses(statuses: RunStatus[]): Promise<Run[]>;
  updateNotion(id: string, status: NotionStatus, notionUrl?: string): Promise<boolean>;
}
export interface Messenger { send(chatId: string, text: string, buttons?: { text: string; data: string }[][]): Promise<void>; answerCallback(id: string, text?: string): Promise<void>; }
export type BotEvent = { updateId: string; chatId: string; text?: string; callbackId?: string; callbackData?: string };

const forbidden = /(?:\brm\b|remove-item|del\s+\/|rmdir\b|borr(?:a|á|e)\s+(?:todo|el\s+(?:repo|repositorio|proyecto))|elimin(?:a|á|ar)\s+(?:todo|el\s+(?:repo|repositorio|proyecto))|(?:delete|remove|erase)\s+(?:all|the\s+(?:repo|repository|project))|(?:powershell|cmd(?:\.exe)?|bash|zsh)\b|(?:shell|terminal)\s+(?:command|comando)|(?:comando\s+(?:arbitrario|arbitrary))|(?:run|ejecuta|ejecutá)\s+(?:a\s+)?(?:command|comando)|secret|token|api[ _-]?key|password|\.env\b|\bpush\b|deploy|publish|publica(?:r|ción)?|global\s+config|configuraci[oó]n\s+global|outside.{0,30}(?:project|repo)|fuera\s+(?:del\s+)?(?:proyecto|repo)|[A-Za-z]:[\\/]|\\\\|(?:^|[\s"'`])\/[A-Za-z0-9._-]+)/i;
export const normalizePrompt = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const normalizeTelegramCommand = (text: string) => text.replace(/^\/([A-Za-z]+)@[A-Za-z0-9_]+(?=\s|$)/, "/$1");
const isExplicitDocumentationRequest = (text: string): boolean => {
  const normalized = normalizePrompt(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (normalized === "documentar" || normalized === "documenta" || normalized === "documentalo") return true;
  return normalized.length <= 120 && /\b(?:documenta(?:r|lo)?|anota(?:r|lo)?)\b.*\bnotion\b/.test(normalized);
};
export const hashChatId = (id: string) => createHash("sha256").update(id).digest("hex");
export const truncateTelegram = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
export const changeTitle = (prompt: string, limit = 72): string => {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return "Cambio sin título";
  return truncateTelegram(`${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`, limit);
};
export const unavailableExecutor: Executor = {
  async run(input) {
    return { taskId: input.taskId, status: "FAILED", summary: "runner no configurado", filesChanged: [], testsRun: [], testsPassed: false, warnings: [], notionLogRequested: false };
  },
};

export class SafeBot {
  private queue: string[] = [];
  private queued = new Set<string>();
  private running: { id: string; chatHash: string; abort: AbortController } | null = null;
  private documenting: { id: string; chatHash: string; abort: AbortController } | null = null;
  private asking: { id: string; chatHash: string; abort: AbortController } | null = null;
  private documentPromise: Promise<void> | null = null;
  private questionPromise: Promise<void> | null = null;
  private pumpPromise: Promise<void> | null = null;
  private destinations = new Map<string, string>();
  private selections = new Map<string, ModelSelection>();
  private runSelections = new Map<string, ModelSelection>();
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
    private readonly progressDelaysMs: readonly number[] = [15_000, 45_000],
    private readonly documenter?: Documenter,
    private readonly questionAnswerer?: QuestionAnswerer,
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

    const text = normalizeTelegramCommand(event.text ?? "");
    if (text === "/start" || text === "/help") return this.messenger.send(event.chatId, "Comandos: /status, /modelo, /prompt <pedido>, /pregunta <consulta>, /diff, /documentar, /cancel. Notion solo se usa al pedir /documentar y confirmar.");
    if (text === "/status") return this.messenger.send(event.chatId, `Estado: ${this.documenting ? "documentando" : this.asking ? "consultando" : this.running ? "ejecutando" : "libre"}. Cola: ${this.queued.size}. ${this.selectionText(this.selectionFor(event.chatId))}.`);
    if (text === "/modelo") return this.sendModelMenu(event.chatId);
    if (text === "/diff") return this.sendDiff(event.chatId);
    if (text === "/documentar") return this.previewDocumentation(event.chatId);
    if (isExplicitDocumentationRequest(text)) return this.previewDocumentation(event.chatId);
    if (text === "/cancel") return this.cancel(event.chatId);
    if (text.startsWith("/pregunta")) {
      const question = normalizePrompt(text.slice(9));
      if (!question || question.length > 600 || forbidden.test(question)) return this.messenger.send(event.chatId, "Pregunta rechazada por la política local.");
      return this.startQuestion(event.updateId, event.chatId, question);
    }
    if (!text.startsWith("/prompt")) return this.messenger.send(event.chatId, "No reconocí ese pedido. Usá /help para ver los comandos disponibles.");

    const prompt = normalizePrompt(text.slice(7));
    if (!prompt || prompt.length > this.maxPrompt || forbidden.test(prompt)) {
      return this.messenger.send(event.chatId, "Solicitud rechazada por la política local.");
    }
    const id = `tg-${event.updateId}`;
    const run: Run = { id, updateId: event.updateId, chatHash: hashChatId(event.chatId), prompt, status: "PENDING", createdAt: this.now(), notionStatus: "PENDING" };
    if (await this.store.create(run) === "duplicate") {
      const existing = await this.store.get(id);
      if (!existing || existing.id !== id || existing.updateId !== run.updateId || existing.chatHash !== run.chatHash || existing.prompt !== run.prompt || existing.status !== "PENDING") return;
    }
    const selection = this.selectionFor(event.chatId);
    this.runSelections.set(id, selection);
    this.destinations.set(id, event.chatId);
    await this.messenger.send(event.chatId, truncateTelegram(`Vista previa: ${prompt}\n${this.selectionText(selection)}`, this.maxMessage), [[{ text: "Ejecutar", data: `run:${id}` }, { text: "Cancelar", data: `cancel:${id}` }]]);
  }

  async waitForIdle(): Promise<void> {
    while (this.pumpPromise) await this.pumpPromise;
    while (this.documentPromise) await this.documentPromise;
    while (this.questionPromise) await this.questionPromise;
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
    if (this.documenting) this.documenting.abort.abort();
    if (this.asking) this.asking.abort.abort();
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
    if (!id) return;
    if (action === "model" && isModelKey(id)) {
      const current = this.selectionFor(event.chatId);
      this.selections.set(event.chatId, { ...current, model: modelByKey[id] });
      await this.sendModelMenu(event.chatId);
      return;
    }
    if (action === "effort" && isReasoningEffort(id)) {
      const current = this.selectionFor(event.chatId);
      this.selections.set(event.chatId, { ...current, reasoning: id });
      await this.sendModelMenu(event.chatId);
      return;
    }
    if (action !== "run" && action !== "cancel" && action !== "document") return;

    const run = await this.store.get(id);
    if (!run || run.chatHash !== hashChatId(event.chatId)) return;

    if (action === "document") {
      await this.startDocumentation(event.chatId, run);
      return;
    }

    if (action === "cancel") {
      if (await this.cancelRun(run)) await this.sendTerminalTo(event.chatId, id, "Estado: cancelado.");
      return;
    }

    if (run.status !== "PENDING") return;
    if (this.documenting || this.asking) {
      await this.messenger.send(event.chatId, "Hay otra operación activa. Esperá a que termine.");
      return;
    }
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
      this.runSelections.clear();
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
    const stopProgressUpdates = this.startProgressUpdates(id);
    try {
      const selection = this.runSelections.get(id) ?? this.selectionFor(this.destinations.get(id) ?? "");
      const result = await this.executor.run({ taskId: id, prompt: run.prompt, signal: abort.signal, selection });
      if (abort.signal.aborted) {
        await this.store.transition(id, "RUNNING", "CANCELLED", { finishedAt: this.now() });
        await this.sendTerminal(id, "Estado: cancelado.");
        return;
      }
      const terminalMessage = this.resultMessage(result, selection);
      const effectiveStatus: RunStatus = result.status === "COMPLETED" && result.testsPassed ? "COMPLETED" : "FAILED";
      await this.store.transition(id, "RUNNING", effectiveStatus, { finishedAt: this.now(), verificationSummary: terminalMessage });
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
      stopProgressUpdates();
      this.running = null;
      this.destinations.delete(id);
      this.runSelections.delete(id);
    }
  }

  private async cancelRun(run: Run): Promise<boolean> {
    if (run.status !== "PENDING" && run.status !== "CONFIRMED") return false;
    const cancelled = await this.store.transition(run.id, run.status, "CANCELLED", { finishedAt: this.now() });
    if (cancelled) {
      this.queued.delete(run.id);
      this.destinations.delete(run.id);
      this.runSelections.delete(run.id);
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
    if (this.documenting?.chatHash === chatHash) {
      this.documenting.abort.abort();
      await this.messenger.send(chatId, "Cancelación de documentación solicitada.");
      return;
    }
    if (this.asking?.chatHash === chatHash) {
      this.asking.abort.abort();
      await this.messenger.send(chatId, "Cancelación de consulta solicitada.");
      return;
    }
    await this.messenger.send(chatId, "No hay ejecución activa.");
  }

  private async previewDocumentation(chatId: string): Promise<void> {
    if (!this.documenter) {
      await this.messenger.send(chatId, "Notion no está configurado.");
      return;
    }
    if (this.running || this.documenting || this.asking) {
      await this.messenger.send(chatId, "Esperá a que termine la operación actual.");
      return;
    }
    const run = await this.store.findLatestForChat(hashChatId(chatId), ["COMPLETED"]);
    if (!run) {
      await this.messenger.send(chatId, "No hay un cambio completado para documentar.");
      return;
    }
    if (run.notionStatus === "SYNCED" && run.notionUrl) {
      await this.messenger.send(chatId, `Este cambio ya está documentado: ${run.notionUrl}`);
      return;
    }
    await this.messenger.send(chatId, `¿Documentar en Notion este cambio?\n\n${changeTitle(run.prompt)}\n\nEsta acción no es automática.`, [[
      { text: "Documentar en Notion", data: `document:${run.id}` },
      { text: "Cancelar", data: `cancel:${run.id}` },
    ]]);
  }

  private async startDocumentation(chatId: string, run: Run): Promise<void> {
    if (!this.documenter || run.status !== "COMPLETED") return;
    if (run.notionStatus === "SYNCED" && run.notionUrl) {
      await this.messenger.send(chatId, `Este cambio ya está documentado: ${run.notionUrl}`);
      return;
    }
    if (this.running || this.documenting || this.asking || this.closing) {
      await this.messenger.send(chatId, "Esperá a que termine la operación actual.");
      return;
    }
    const abort = new AbortController();
    this.documenting = { id: run.id, chatHash: run.chatHash, abort };
    const selection = this.selectionFor(chatId);
    await this.sendSafely(chatId, "📝 Documentación en Notion iniciada por pedido y confirmación del usuario.");
    this.documentPromise = this.performDocumentation(chatId, run, abort, selection).finally(() => {
      this.documenting = null;
      this.documentPromise = null;
    });
  }

  private async performDocumentation(chatId: string, run: Run, abort: AbortController, selection: ModelSelection): Promise<void> {
    try {
      const result = await this.documenter!.document({ run, signal: abort.signal, selection });
      if (abort.signal.aborted) {
        await this.sendSafely(chatId, "Estado: documentación cancelada.");
        return;
      }
      if (result.status !== "COMPLETED") {
        await this.store.updateNotion(run.id, "FAILED");
        await this.sendSafely(chatId, `Estado: fallido. No se pudo documentar en Notion. Detalle: ${this.safeDetail(result.summary)}`);
        return;
      }
      await this.store.updateNotion(run.id, "SYNCED", result.notionUrl);
      await this.sendSafely(chatId, `Documentación creada en Notion: ${result.notionUrl}`);
    } catch {
      if (abort.signal.aborted) {
        await this.sendSafely(chatId, "Estado: documentación cancelada.");
      } else {
        await this.store.updateNotion(run.id, "FAILED");
        await this.sendSafely(chatId, "Estado: fallido. No se pudo documentar en Notion.");
      }
    }
  }

  private async startQuestion(updateId: string, chatId: string, question: string): Promise<void> {
    if (!this.questionAnswerer) {
      await this.messenger.send(chatId, "Consultas de base de datos no configuradas.");
      return;
    }
    if (this.running || this.documenting || this.asking || this.queued.size > 0) {
      await this.messenger.send(chatId, "Esperá a que termine la operación actual.");
      return;
    }
    const taskId = `q-${updateId}`;
    const abort = new AbortController();
    const selection = this.selectionFor(chatId);
    this.asking = { id: taskId, chatHash: hashChatId(chatId), abort };
    await this.sendSafely(chatId, `🔎 Consultando la base de datos en modo de solo lectura…\n${this.selectionText(selection)}`);
    this.questionPromise = this.performQuestion(chatId, taskId, question, abort, selection).finally(() => {
      this.asking = null;
      this.questionPromise = null;
    });
  }

  private async performQuestion(chatId: string, taskId: string, question: string, abort: AbortController, selection: ModelSelection): Promise<void> {
    try {
      const result = await this.questionAnswerer!.answer({ taskId, question, signal: abort.signal, selection, now: this.now() });
      if (abort.signal.aborted) {
        await this.sendSafely(chatId, "Estado: consulta cancelada.");
        return;
      }
      const warning = result.warning ? `\nAdvertencia: ${this.safeDetail(result.warning)}` : "";
      const prefix = result.status === "COMPLETED" ? "Resultado" : "No se pudo responder";
      await this.sendSafely(chatId, truncateTelegram(`${prefix}: ${this.safeDetail(result.answer)}${warning}`, this.maxMessage));
    } catch {
      await this.sendSafely(chatId, abort.signal.aborted ? "Estado: consulta cancelada." : "Estado: fallido. No se pudo consultar la base de datos.");
    }
  }

  private selectionFor(chatId: string): ModelSelection {
    return { ...(this.selections.get(chatId) ?? defaultModelSelection) };
  }

  private selectionText(selection: ModelSelection): string {
    return `Modelo: ${modelName(selection.model)} · razonamiento: ${selection.reasoning}`;
  }

  private async sendModelMenu(chatId: string): Promise<void> {
    const selection = this.selectionFor(chatId);
    const modelButtons = modelKeys.map((key) => ({ text: `${selection.model === modelByKey[key] ? "✓ " : ""}${key[0].toUpperCase()}${key.slice(1)}`, data: `model:${key}` }));
    const effortLabels: Record<(typeof reasoningEfforts)[number], string> = { low: "Bajo", medium: "Medio", high: "Alto", xhigh: "Muy alto", max: "Máximo" };
    const effortButtons = reasoningEfforts.map((effort) => ({ text: `${selection.reasoning === effort ? "✓ " : ""}${effortLabels[effort]}`, data: `effort:${effort}` }));
    await this.messenger.send(chatId, `${this.selectionText(selection)}. La selección se aplica a las próximas tareas hasta que la cambies.`, [modelButtons, effortButtons.slice(0, 3), effortButtons.slice(3)]);
  }

  private async sendProgress(id: string): Promise<void> {
    const chatId = this.destinations.get(id);
    if (chatId) await this.sendSafely(chatId, "🔍 Analizando el proyecto…");
  }

  private startProgressUpdates(id: string): () => void {
    const messages = [
      "🛠️ Codex sigue trabajando: revisando y aplicando cambios seguros.",
      "⏳ La ejecución continúa. Al terminar recibirás el resultado y las verificaciones.",
    ];
    const timers = this.progressDelaysMs.slice(0, messages.length).map((delay, index) => setTimeout(() => {
      const chatId = this.destinations.get(id);
      if (chatId && this.running?.id === id) void this.sendSafely(chatId, messages[index]);
    }, delay));
    return () => timers.forEach(clearTimeout);
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

  private safeDetail(value: string): string {
    if (!value || /[\u0000-\u001f\u007f]|C:\\Users\\|\\Users\\|\/home\/|token|secret|api[_ -]?key|password/i.test(value)) return "[detalle omitido por seguridad]";
    return value.length <= 500 ? value : `${value.slice(0, 499)}…`;
  }

  private resultMessage(result: ExecutorResult, selection: ModelSelection): string {
    const status = result.status !== "COMPLETED" ? "fallido" : result.testsPassed ? (result.warnings.length ? "completado con advertencias" : "completado") : "cambio aplicado, pero verificación fallida";
    const lines = [
      `Estado: ${status}.`,
      this.selectionText(selection),
      `Resumen: ${this.safeDetail(result.summary)}`,
      `Advertencias (${result.warnings.length}):`,
      ...(result.warnings.length ? result.warnings.slice(0, 12).map((warning) => `- ${this.safeDetail(warning)}`) : ["- Ninguna."]),
      `Archivos modificados (${result.filesChanged.length}):`,
      ...(result.filesChanged.length ? result.filesChanged.slice(0, 20).map((file) => `- ${this.safeDetail(file)}`) : ["- Ninguno."]),
      `Verificaciones (${result.testsRun.length}) — ${result.testsPassed ? "aprobadas" : "fallidas"}:`,
      ...(result.testsRun.length ? result.testsRun.slice(0, 12).map((test) => `- ${this.safeDetail(test)}`) : ["- Ninguna informada."]),
    ];
    return truncateTelegram(lines.join("\n"), this.maxMessage);
  }
}
