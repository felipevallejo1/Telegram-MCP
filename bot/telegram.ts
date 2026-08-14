import type { BotEvent, Messenger } from "./core";

export type TelegramTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type TelegramUpdate = { updateId: string; event?: BotEvent };

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null;
const apiError = (): Error => new Error("Telegram request failed.");

export class TelegramAdapter implements Messenger {
  private offset = 0;

  constructor(
    private readonly token: string,
    private readonly transport: TelegramTransport = fetch,
    private readonly timeoutSeconds = 20,
    private readonly lifecycleSignal?: AbortSignal,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  async updates(signal?: AbortSignal): Promise<TelegramUpdate[]> {
    const result = await this.request("getUpdates", {
      offset: this.offset,
      timeout: this.timeoutSeconds,
      allowed_updates: ["message", "callback_query"],
    }, signal);
    if (!Array.isArray(result)) throw apiError();
    return result.flatMap((update) => this.mapUpdate(update));
  }

  ack(updateId: string): void {
    const numericId = Number(updateId);
    if (!Number.isSafeInteger(numericId) || numericId < 0) return;
    this.offset = Math.max(this.offset, numericId + 1);
  }

  async send(chatId: string, text: string, buttons?: { text: string; data: string }[][]): Promise<void> {
    await this.request("sendMessage", {
      chat_id: chatId,
      text,
      ...(buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((button) => ({ text: button.text, callback_data: button.data }))) } } : {}),
    });
  }

  async answerCallback(id: string, text?: string): Promise<void> {
    await this.request("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
  }

  private url(method: string): string {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  private async request(method: string, payload: JsonRecord, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted || this.lifecycleSignal?.aborted) throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    const requestTimeout = Math.max(this.requestTimeoutMs, method === "getUpdates" ? (this.timeoutSeconds + 5) * 1000 : 0);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    this.lifecycleSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, requestTimeout);
    const aborted = new Promise<never>((_resolveAbort, rejectAbort) => {
      const reject = () => rejectAbort(signal?.aborted || this.lifecycleSignal?.aborted ? new DOMException("Aborted", "AbortError") : apiError());
      if (controller.signal.aborted) reject(); else controller.signal.addEventListener("abort", reject, { once: true });
    });
    let response: Response;
    try {
      response = await Promise.race([this.transport(this.url(method), {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }), aborted]);
      if (!response.ok) throw apiError();
      let body: unknown;
      try { body = await Promise.race([response.json(), aborted]); } catch (error) { if (signal?.aborted || this.lifecycleSignal?.aborted) throw error; throw apiError(); }
      if (!isRecord(body) || body.ok !== true) throw apiError();
      return body.result;
    } catch (error) {
      if (signal?.aborted || this.lifecycleSignal?.aborted) throw error;
      throw apiError();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.lifecycleSignal?.removeEventListener("abort", abort);
    }
  }

  private mapUpdate(update: unknown): TelegramUpdate[] {
    if (!isRecord(update) || typeof update.update_id !== "number" || !Number.isSafeInteger(update.update_id) || update.update_id < 0) return [];
    const updateId = String(update.update_id);
    const callback = isRecord(update.callback_query) ? update.callback_query : null;
    const message = isRecord(update.message) ? update.message : callback && isRecord(callback.message) ? callback.message : null;
    if (!message || !isRecord(message.chat) || (typeof message.chat.id !== "string" && typeof message.chat.id !== "number")) return [{ updateId }];

    const chatId = String(message.chat.id);
    if (callback) {
      if (typeof callback.id !== "string" || typeof callback.data !== "string") return [{ updateId }];
      return [{
        updateId,
        event: { updateId, chatId, callbackId: callback.id, callbackData: callback.data },
      }];
    }
    if (typeof message.text !== "string") return [{ updateId }];
    return [{ updateId, event: { updateId, chatId, text: message.text } }];
  }
}
