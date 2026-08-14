import { describe, expect, it } from "vitest";
import { TelegramPoller, loadBotConfig, type Delay, type PollingTransport } from "../bot/index";

const abort = (): DOMException => new DOMException("Aborted", "AbortError");

describe("TelegramPoller", () => {
  it("procesa y luego confirma cada update; la cancelación cierra el polling", async () => {
    const controller = new AbortController();
    const acked: string[] = [];
    const handled: string[] = [];
    const transport: PollingTransport = {
      updates: async () => [{ updateId: "7", event: { updateId: "7", chatId: "allowed", text: "/status" } }],
      ack: (id) => acked.push(id),
    };
    await new TelegramPoller(transport, async (event) => { handled.push(event.updateId); controller.abort(); }).run(controller.signal);
    expect(handled).toEqual(["7"]);
    expect(acked).toEqual(["7"]);
  });

  it("reintenta con backoff limitado y no confirma un update cuyo handler falla", async () => {
    const waits: number[] = [];
    const wait: Delay = async (milliseconds) => { waits.push(milliseconds); };
    let calls = 0;
    const controller = new AbortController();
    const transport: PollingTransport = {
      updates: async () => {
        calls += 1;
        if (calls < 3) throw new Error("temporary");
        controller.abort();
        throw abort();
      },
      ack: () => { throw new Error("must not ack failed polling"); },
    };
    await new TelegramPoller(transport, async () => undefined, wait, 3, 10).run(controller.signal);
    expect(waits).toEqual([10, 20]);
  });

  it("detiene con error tras el máximo de reintentos", async () => {
    const wait: Delay = async () => undefined;
    const transport: PollingTransport = { updates: async () => { throw new Error("network"); }, ack: () => undefined };
    await expect(new TelegramPoller(transport, async () => undefined, wait, 1).run(new AbortController().signal)).rejects.toThrow("Telegram polling retry limit reached.");
  });

  it("no reinicia retries si el mismo handler falla antes del ack", async () => {
    const waits: number[] = [];
    const transport: PollingTransport = {
      updates: async () => [{ updateId: "9", event: { updateId: "9", chatId: "allowed", text: "/status" } }],
      ack: () => { throw new Error("should not acknowledge"); },
    };
    await expect(new TelegramPoller(transport, async () => { throw new Error("handler"); }, async (ms) => { waits.push(ms); }, 2, 5).run(new AbortController().signal)).rejects.toThrow("Telegram polling retry limit reached.");
    expect(waits).toEqual([5, 10]);
  });
  it("termina normalmente si el abort ocurre durante el backoff", async () => {
    const controller = new AbortController(); let waits = 0; const transport: PollingTransport = { updates: async () => { throw new Error("network"); }, ack: () => { throw new Error("no ack"); } };
    await new TelegramPoller(transport, async () => undefined, async () => { waits += 1; controller.abort(); throw new DOMException("Aborted", "AbortError"); }).run(controller.signal);
    expect(waits).toBe(1);
  });
  it("confirma un update ignorable sin llamar el handler", async () => {
    const controller = new AbortController(); const acked: string[] = []; let handlerCalls = 0; let polls = 0;
    const transport: PollingTransport = {
      updates: async () => { polls += 1; if (polls === 1) return [{ updateId: "8" }]; controller.abort(); throw abort(); },
      ack: (id) => acked.push(id),
    };
    await new TelegramPoller(transport, async () => { handlerCalls += 1; }).run(controller.signal);
    expect(handlerCalls).toBe(0); expect(acked).toEqual(["8"]);
  });
});

describe("loadBotConfig", () => {
  it("lee y valida .env.local sin exponer valores", async () => {
    const config = await loadBotConfig(async () => "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwxyz_123456\nTELEGRAM_ALLOWED_CHAT_ID=-10042\nREQUEST_TIMEOUT_MS=12000\n");
    expect(config.allowedChatId).toBe("-10042");
    expect(config.requestTimeoutMs).toBe(12000);
    expect(config.token).toMatch(/^123456:/);
  });

  it("rechaza configuración local incompleta o inválida", async () => {
    await expect(loadBotConfig(async () => "TELEGRAM_BOT_TOKEN=invalid\nTELEGRAM_ALLOWED_CHAT_ID=chat\n")).rejects.toThrow("Local Telegram configuration is missing or invalid.");
    await expect(loadBotConfig(async () => "TELEGRAM_BOT_TOKEN=123456:abcdefghijklmnopqrstuvwxyz_123456\nTELEGRAM_ALLOWED_CHAT_ID=42\nREQUEST_TIMEOUT_MS=10\n")).rejects.toThrow("Local Telegram configuration is missing or invalid.");
  });
});
