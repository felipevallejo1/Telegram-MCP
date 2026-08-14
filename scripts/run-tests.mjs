import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const prismaDirectory = resolve(projectRoot, "prisma");
const schemaPath = resolve(prismaDirectory, "schema.prisma");
const databasePath = resolve(prismaDirectory, "test.db");
const databaseSidecars = ["-journal", "-wal", "-shm"].map((suffix) => `${databasePath}${suffix}`);
const cli = resolve(projectRoot, "node_modules", "prisma", "build", "index.js");
const vitest = resolve(projectRoot, "node_modules", "vitest", "vitest.mjs");
const env = { ...process.env, DATABASE_URL: "file:./test.db", NODE_ENV: "test" };

if (databasePath !== resolve(projectRoot, "prisma", "test.db")) throw new Error("Invalid test database path.");
await rm(databasePath, { force: true });
for (const sidecarPath of databaseSidecars) await rm(sidecarPath, { force: true });
await writeFile(databasePath, "");
const run = (command, args) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit", env });
  child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`${args[0]} exited with ${code}`)));
});
await run(process.execPath, [cli, "migrate", "deploy", "--schema", schemaPath]);
await run(process.execPath, [vitest, "run"]);
