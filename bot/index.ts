import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SafeBot, type BotEvent } from "./core";
import { FixedGitDiffProvider } from "./diff";
import { CodexExecutor, MEDICONTROL_PROJECT_ROOT } from "./executor";
import { prismaRunStore } from "./prisma-store";
import { TelegramAdapter, type TelegramUpdate } from "./telegram";
import { prisma } from "../src/lib/prisma";

export type BotConfig = { token: string; allowedChatId: string; requestTimeoutMs: number };
export type PollingTransport = Pick<TelegramAdapter, "updates" | "ack">;
export type UpdateHandler = (update: BotEvent) => Promise<void>;
export type Delay = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

const tokenPattern = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;
const chatIdPattern = /^-?\d+$/;
const localEnvironmentPath = resolve(MEDICONTROL_PROJECT_ROOT, ".env.local");

const delay: Delay = (milliseconds, signal) => new Promise((resolveDelay, reject) => {
  if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
  const timer = setTimeout(resolveDelay, milliseconds);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

const parseLocalEnvironment = (contents: string): Record<string, string> => {
  const values: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error("Invalid local environment file.");
    const rawValue = match[2].trim();
    if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) values[match[1]] = rawValue.slice(1, -1);
    else if (!/[\s#]/.test(rawValue)) values[match[1]] = rawValue;
    else throw new Error("Invalid local environment file.");
  }
  return values;
};

export const loadBotConfig = async (readLocalFile: (path: string, encoding: "utf8") => Promise<string> = readFile): Promise<BotConfig> => {
  let localValues: Record<string, string> = {};
  try { localValues = parseLocalEnvironment(await readLocalFile(localEnvironmentPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Local bot configuration is invalid.");
  }
  const token = process.env.TELEGRAM_BOT_TOKEN ?? localValues.TELEGRAM_BOT_TOKEN ?? "";
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID ?? localValues.TELEGRAM_ALLOWED_CHAT_ID ?? "";
  const timeoutText = process.env.REQUEST_TIMEOUT_MS ?? localValues.REQUEST_TIMEOUT_MS ?? "10000";
  const requestTimeoutMs = Number(timeoutText);
  if (!tokenPattern.test(token) || !chatIdPattern.test(allowedChatId) || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 60000) throw new Error("Local Telegram configuration is missing or invalid.");
  return { token, allowedChatId, requestTimeoutMs };
};

export class TelegramPoller {
  constructor(
    private readonly transport: PollingTransport,
    private readonly handle: UpdateHandler,
    private readonly wait: Delay = delay,
    private readonly maxRetries = 5,
    private readonly initialBackoffMs = 250,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      try {
        const updates = await this.transport.updates(signal);
        for (const update of updates) {
          if (signal.aborted) return;
          if (update.event) await this.handle(update.event);
          this.transport.ack(update.updateId);
        }
        failures = 0;
      } catch (error) {
        if (signal.aborted || (error as DOMException).name === "AbortError") return;
        failures += 1;
        if (failures > this.maxRetries) throw new Error("Telegram polling retry limit reached.");
        try { await this.wait(this.initialBackoffMs * 2 ** (failures - 1), signal); }
        catch (waitError) {
          if (signal.aborted || (waitError as DOMException).name === "AbortError") return;
          throw waitError;
        }
      }
    }
  }
}

export const startLocalBot = async (): Promise<void> => {
  const config = await loadBotConfig();
  const controller = new AbortController();
  const telegram = new TelegramAdapter(config.token, fetch, 20, controller.signal, config.requestTimeoutMs);
  const bot = new SafeBot(config.allowedChatId, prismaRunStore, telegram, new CodexExecutor(), undefined, undefined, undefined, undefined, new FixedGitDiffProvider(), () => controller.abort());
  const shutdown = () => controller.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try { await bot.recoverInterrupted(); await new TelegramPoller(telegram, (event) => bot.handle(event)).run(controller.signal); }
  finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    controller.abort();
    await bot.shutdown();
    await prisma.$disconnect();
  }
};

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  void startLocalBot().catch(() => { process.exitCode = 1; console.error("El bot local no pudo iniciarse. Revise la configuracion local."); });
}
