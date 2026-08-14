import { describe, expect, it } from "vitest";
import { TelegramAdapter, type TelegramTransport } from "../bot/telegram";

type RecordedRequest = { url: string; body: Record<string, unknown>; signal?: AbortSignal | null };
const response = (body: unknown, ok = true): Response => new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { "content-type": "application/json" } });
const transport = (bodies: unknown[]) => {
  const requests: RecordedRequest[] = [];
  const fetcher: TelegramTransport = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown>, signal: init?.signal });
    return response(bodies.shift() ?? { ok: true, result: [] });
  };
  return { fetcher, requests };
};

describe("TelegramAdapter", () => {
  it("preserva el offset hasta ack y filtra updates inválidos", async () => {
    const { fetcher, requests } = transport([
      { ok: true, result: [{ update_id: 7, message: { chat: { id: 42 }, text: "/start" } }, { update_id: 8, message: { chat: {}, text: "invalido" } }] },
      { ok: true, result: [] },
      { ok: true, result: [] },
    ]);
    const adapter = new TelegramAdapter("safe-token", fetcher, 11);
    const updates = await adapter.updates();
    expect(updates).toEqual([{ updateId: "7", event: { updateId: "7", chatId: "42", text: "/start" } }, { updateId: "8" }]);
    await adapter.updates();
    adapter.ack("7");
    await adapter.updates();
    expect(requests.map((request) => request.body)).toEqual([
      { offset: 0, timeout: 11, allowed_updates: ["message", "callback_query"] },
      { offset: 0, timeout: 11, allowed_updates: ["message", "callback_query"] },
      { offset: 8, timeout: 11, allowed_updates: ["message", "callback_query"] },
    ]);
  });

  it("envía mensajes, teclado inline y respuestas de callback", async () => {
    const { fetcher, requests } = transport([{ ok: true, result: true }, { ok: true, result: true }]);
    const adapter = new TelegramAdapter("safe-token", fetcher);
    await adapter.send("42", "texto", [[{ text: "Ejecutar", data: "run:1" }]]);
    await adapter.answerCallback("callback-1", "recibido");
    expect(requests[0].body).toEqual({ chat_id: "42", text: "texto", reply_markup: { inline_keyboard: [[{ text: "Ejecutar", callback_data: "run:1" }]] } });
    expect(requests[1].body).toEqual({ callback_query_id: "callback-1", text: "recibido" });
  });

  it("rechaza errores HTTP y API con un mensaje sanitizado", async () => {
    const http = new TelegramAdapter("secret-token", async () => response({ detail: "secret-token" }, false));
    const api = new TelegramAdapter("secret-token", async () => response({ ok: false, description: "secret-token" }));
    await expect(http.updates()).rejects.toThrow("Telegram request failed.");
    await expect(api.updates()).rejects.toThrow("Telegram request failed.");
  });

  it("propaga una cancelación por AbortSignal sin avanzar offset", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const adapter = new TelegramAdapter("safe-token", async () => { called = true; throw new Error("must not fetch"); });
    await expect(adapter.updates(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });

  it("preserva un update no textual con id valido para confirmarlo", async () => {
    const { fetcher } = transport([{ ok: true, result: [{ update_id: 9, message: { chat: { id: 42 }, sticker: { emoji: "x" } } }, { update_id: "bad", message: { chat: { id: 42 }, text: "x" } }] }]);
    const adapter = new TelegramAdapter("safe-token", fetcher);
    await expect(adapter.updates()).resolves.toEqual([{ updateId: "9" }]);
  });

  it("cancela requests colgados por timeout o lifecycle sin filtrar detalles", async () => {
    const pending: TelegramTransport = async (_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    const timed = new TelegramAdapter("safe-token", pending, 20, undefined, 2);
    await expect(timed.send("42", "x")).rejects.toThrow("Telegram request failed.");
    const lifecycle = new AbortController(); const stopped = new TelegramAdapter("safe-token", pending, 20, lifecycle.signal, 1000);
    const running = stopped.send("42", "x"); lifecycle.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });

  it("mantiene timeout y lifecycle mientras espera el body JSON", async () => {
    const pendingBody: TelegramTransport = async (_input, init) => ({ ok: true, json: () => new Promise((resolveBody, rejectBody) => init?.signal?.addEventListener("abort", () => rejectBody(new DOMException("aborted", "AbortError")), { once: true })) } as unknown as Response);
    await expect(new TelegramAdapter("safe-token", pendingBody, 20, undefined, 2).send("42", "x")).rejects.toThrow("Telegram request failed.");
    const lifecycle = new AbortController(); const running = new TelegramAdapter("safe-token", pendingBody, 20, lifecycle.signal, 1000).answerCallback("cb"); lifecycle.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});
