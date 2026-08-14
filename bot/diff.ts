import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { realpath } from "node:fs/promises";
import type { DiffProvider } from "./core";
import { MEDICONTROL_PROJECT_ROOT } from "./executor";

type DiffProcess = Pick<ChildProcessWithoutNullStreams, "stdout" | "stderr" | "pid" | "kill" | "on" | "once">;
export type GitSpawner = (command: string, args: readonly string[], options: { cwd: string; shell: false; windowsHide: true; stdio: "pipe" }) => DiffProcess;
const defaultSpawn: GitSpawner = (command, args, options) => nodeSpawn(command, args, options);
const maximumBytes = 100_000;
const maximumMessage = 3_000;

const sanitize = (text: string): string => {
  const normalized = text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (/(?:[A-Za-z]:\\|\\\\|\/Users\/|\/home\/)/.test(normalized)) throw new Error("Git diff failed.");
  return normalized.length > maximumMessage ? `${normalized.slice(0, maximumMessage - 1)}…` : normalized;
};

export class FixedGitDiffProvider implements DiffProvider {
  private readonly projectRoot: string;
  constructor(projectRoot = MEDICONTROL_PROJECT_ROOT, private readonly spawnProcess: GitSpawner = defaultSpawn, private readonly timeoutMs = 10_000) {
    this.projectRoot = resolve(projectRoot);
    if (this.projectRoot.toLowerCase() !== resolve(MEDICONTROL_PROJECT_ROOT).toLowerCase() || !existsSync(this.projectRoot)) throw new Error("Invalid fixed MediControl workspace.");
  }

  async get(): Promise<string> {
    const root = await realpath(this.projectRoot).catch(() => { throw new Error("Invalid fixed MediControl workspace."); });
    if (root.toLowerCase() !== resolve(MEDICONTROL_PROJECT_ROOT).toLowerCase()) throw new Error("Invalid fixed MediControl workspace.");
    const status = await this.run(root, ["status", "--short", "--untracked-files=all"]);
    const stat = await this.run(root, ["diff", "--no-ext-diff", "--stat", "--", "."]);
    return sanitize([status, stat].filter(Boolean).join("\n")) || "No hay cambios locales.";
  }

  private run(root: string, args: readonly string[]): Promise<string> {
    return new Promise((resolveResult, rejectResult) => {
      const child = this.spawnProcess("git.exe", args, { cwd: root, shell: false, windowsHide: true, stdio: "pipe" });
      let output = ""; let bytes = 0; let done = false;
      const finish = (error?: Error): void => { if (done) return; done = true; clearTimeout(timeout); error ? rejectResult(new Error("Git diff failed.")) : resolveResult(output); };
      const timeout = setTimeout(() => { child.kill(); finish(new Error("Git diff failed.")); }, this.timeoutMs);
      child.stdout.on("data", (chunk: Buffer | string) => { bytes += Buffer.byteLength(String(chunk)); if (bytes > maximumBytes) { child.kill(); finish(new Error("Git diff failed.")); } else output += String(chunk); });
      child.stderr.on("data", (chunk: Buffer | string) => { bytes += Buffer.byteLength(String(chunk)); if (bytes > maximumBytes) { child.kill(); finish(new Error("Git diff failed.")); } });
      child.once("error", () => finish(new Error("Git diff failed.")));
      child.once("close", (code: number | null) => finish(code === 0 ? undefined : new Error("Git diff failed.")));
    });
  }
}
