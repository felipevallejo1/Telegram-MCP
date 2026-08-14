import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { Run } from "../bot/core";
import type { ProcessSpawner } from "../bot/executor";
import { CodexNotionDocumenter, NOTION_RESULT_SCHEMA, loadNotionTarget, validateDocumentationResult } from "../bot/notion";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn();
  pid = 7812;
}

const run: Run = {
  id: "tg-doc-1",
  updateId: "doc-1",
  chatHash: "hash",
  prompt: "cambiar el titulo ficticio",
  status: "COMPLETED",
  createdAt: new Date("2026-08-12T10:00:00.000Z"),
  finishedAt: new Date("2026-08-12T10:01:00.000Z"),
  verificationSummary: "Estado completado con pruebas aprobadas",
  notionStatus: "PENDING",
};

const result = { taskId: run.id, status: "COMPLETED" as const, notionUrl: "https://www.notion.so/medicontrol-change", summary: "documentado" };
const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let index = 0; index < 100; index += 1) {
    if (condition()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1));
  }
  throw new Error("timed out waiting for child");
};

describe("CodexNotionDocumenter", () => {
  it("usa Notion solo con la accion fija, read-only local y confirmacion declarada", async () => {
    const child = new FakeChild();
    const calls: { command: string; args: readonly string[]; options: unknown }[] = [];
    const spawn = ((command: string, args: readonly string[], options: unknown) => { calls.push({ command, args, options }); return child; }) as unknown as ProcessSpawner;
    const target = await loadNotionTarget("https://www.notion.so/00000000000000000000000000000000");
    const documenter = new CodexNotionDocumenter(target, 1_000, spawn, async () => undefined);
    let stdin = "";
    child.stdin.on("data", (chunk) => { stdin += String(chunk); });
    const pending = documenter.document({ run, signal: new AbortController().signal });
    await waitFor(() => calls.length === 1);
    const args = calls[0].args;
    const output = String(args[args.indexOf("--output-last-message") + 1]);
    await writeFile(output, JSON.stringify(result));
    child.emit("close", 0, null);
    await expect(pending).resolves.toEqual(result);
    expect(calls[0].command).toBe("codex.exe");
    expect(args).toContain("read-only");
    expect(args).not.toContain("--approve-for-me");
    expect(args).toEqual(expect.arrayContaining(["--model", "gpt-5.6-terra", "--config", "model_reasoning_effort=\"medium\""]));
    expect(args).toContain(NOTION_RESULT_SCHEMA);
    expect(stdin).toContain("escribio /documentar y confirmo expresamente");
    expect(stdin).toContain("plugin oficial instalado de Notion");
    expect(stdin).toContain("codex_apps/notion");
    expect(stdin).toContain("No uses ningun servidor MCP de Notion configurado por separado");
    expect(stdin).toContain("El titulo visible debe ser una descripcion breve y concreta del objetivo");
    expect(stdin).toContain(`Referencia interna: ${run.id}`);
    expect(stdin).not.toContain(`titulada \"MediControl - Cambio ${run.id}\"`);
    expect(stdin).toContain(target);
    expect(stdin).toContain("BEGIN UNTRUSTED CHANGE DATA");
    expect(stdin).toContain(run.prompt);
    await expect(readFile(output)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rechaza resultados con otra tarea, campos extra o URL ajena a Notion", () => {
    expect(validateDocumentationResult(result, run.id)).toEqual(result);
    expect(validateDocumentationResult({ ...result, taskId: "other" }, run.id)).toBeNull();
    expect(validateDocumentationResult({ ...result, extra: true }, run.id)).toBeNull();
    expect(validateDocumentationResult({ ...result, notionUrl: "https://example.com/page" }, run.id)).toBeNull();
    expect(validateDocumentationResult({ ...result, status: "FAILED", notionUrl: "" }, run.id)).toMatchObject({ status: "FAILED" });
  });

  it("valida el destino público recibido desde el entorno", async () => {
    await expect(loadNotionTarget("https://www.notion.so/00000000000000000000000000000000")).resolves.toContain("notion.so");
    await expect(loadNotionTarget("https://example.com/private")).rejects.toThrow("Invalid Notion target configuration.");
  });
});
