import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { FixedGitDiffProvider, type GitSpawner } from "../bot/diff";

class FakeGit extends EventEmitter { readonly stdout = new PassThrough(); readonly stderr = new PassThrough(); readonly kill = vi.fn(); pid = 123; }
const waitFor = async (condition: () => boolean): Promise<void> => { for (let i = 0; i < 100; i += 1) { if (condition()) return; await new Promise((resolveWait) => setTimeout(resolveWait, 1)); } throw new Error("timed out"); };

describe("FixedGitDiffProvider", () => {
  it("runs fixed status then stat without shell and includes untracked output", async () => {
    const status = new FakeGit(); const stat = new FakeGit(); const children = [status, stat]; const calls: { command: string; args: readonly string[]; options: unknown }[] = [];
    const spawn = ((command: string, args: readonly string[], options: { cwd: string; shell: false; windowsHide: true; stdio: "pipe" }) => { calls.push({ command, args, options }); return children.shift()!; }) as unknown as GitSpawner;
    const running = new FixedGitDiffProvider(undefined, spawn).get();
    await waitFor(() => calls.length === 1); status.stdout.write("?? tests/new.test.ts\n"); status.emit("close", 0, null);
    await waitFor(() => calls.length === 2); stat.stdout.write(" bot/index.ts | 2 ++\n"); stat.emit("close", 0, null);
    await expect(running).resolves.toBe("?? tests/new.test.ts bot/index.ts | 2 ++");
    expect(calls).toEqual([
      { command: "git.exe", args: ["status", "--short", "--untracked-files=all"], options: expect.objectContaining({ shell: false }) },
      { command: "git.exe", args: ["diff", "--no-ext-diff", "--stat", "--", "."], options: expect.objectContaining({ shell: false }) },
    ]);
  });

  it("fails closed on spawn error and timeout", async () => {
    const failing = new FakeGit(); let spawned = false; const errorSpawn = (() => { spawned = true; return failing; }) as unknown as GitSpawner;
    const failed = new FixedGitDiffProvider(undefined, errorSpawn).get(); await waitFor(() => spawned); failing.emit("error", new Error("no git"));
    await expect(failed).rejects.toThrow("Git diff failed.");

    const hanging = new FakeGit(); const timeoutSpawn = (() => hanging) as unknown as GitSpawner;
    await expect(new FixedGitDiffProvider(undefined, timeoutSpawn, 2).get()).rejects.toThrow("Git diff failed.");
    expect(hanging.kill).toHaveBeenCalledOnce();
  });
});
