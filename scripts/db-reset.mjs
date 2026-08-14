import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const prismaDirectory = resolve(projectRoot, "prisma");
const schemaPath = resolve(prismaDirectory, "schema.prisma");
const databasePath = resolve(prismaDirectory, "medicontrol.db");
const databaseSidecars = ["-journal", "-wal", "-shm"].map((suffix) => `${databasePath}${suffix}`);
const localDatabaseUrl = "file:./medicontrol.db";
const cli = resolve(projectRoot, "node_modules", "prisma", "build", "index.js");
const tsx = resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");

if (databasePath !== resolve(projectRoot, "prisma", "medicontrol.db")) throw new Error("Invalid local database path.");
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== localDatabaseUrl) throw new Error("db:reset only permits the local project SQLite database.");

const env = { ...process.env, DATABASE_URL: localDatabaseUrl };
const run = (args) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [cli, ...args], { cwd: projectRoot, stdio: "inherit", env });
  child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`Prisma exited with ${code}`)));
});

await rm(databasePath, { force: true });
for (const sidecarPath of databaseSidecars) await rm(sidecarPath, { force: true });
await writeFile(databasePath, "");
await run(["migrate", "reset", "--force", "--skip-seed", "--schema", schemaPath]);
await run(["generate", "--schema", schemaPath]);
await new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [tsx, resolve(projectRoot, "scripts", "seed.ts")], { cwd: projectRoot, stdio: "inherit", env });
  child.on("exit", (code) => code === 0 ? resolveRun() : reject(new Error(`Seed exited with ${code}`)));
});
