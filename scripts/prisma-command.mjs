import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const schemaPath = resolve(projectRoot, "prisma", "schema.prisma");
const databasePath = resolve(projectRoot, "prisma", "medicontrol.db");
const localDatabaseUrl = "file:./medicontrol.db";
const cli = resolve(projectRoot, "node_modules", "prisma", "build", "index.js");

if (process.argv.slice(2).join(" ") !== "migrate deploy") throw new Error("Only 'migrate deploy' is allowed.");
if (databasePath !== resolve(projectRoot, "prisma", "medicontrol.db")) throw new Error("Invalid local database path.");
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== localDatabaseUrl) throw new Error("db:migrate only permits the local project SQLite database.");
if (!existsSync(databasePath)) await writeFile(databasePath, "");

const child = spawn(process.execPath, [cli, "migrate", "deploy", "--schema", schemaPath], { cwd: projectRoot, stdio: "inherit", env: { ...process.env, DATABASE_URL: localDatabaseUrl } });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
