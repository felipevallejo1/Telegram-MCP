# MediControl

Local fictional MediControl demonstration with a Next.js interface, SQLite data, and
a manually started, confirmation-gated Telegram-to-Codex bridge. The visible web page
states that the project uses fictional data only.

## Requirements

- Windows PowerShell
- Node.js 22 or later
- npm (use `npm.cmd` from PowerShell)

## Local commands

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test
```

`dev` starts the local Next.js server. `lint`, `build`, and `test` are implemented.

## Local fictitious database

SQLite data is local, generated, and ignored by Git. No `.env` file is necessary: the
safe default is `file:./medicontrol.db`, relative to `prisma/schema.prisma`. To recreate
the complete demonstration database from zero in Windows PowerShell, run:

```powershell
npm.cmd run db:reset
npm.cmd run db:verify
```

`db:migrate` applies the versioned SQLite migrations, `db:seed` inserts deterministic
fictional records for the current UTC day, and `db:verify` checks the minimum seed
counts and its following 14-day slot window. UTC is used in persistence; the future
presentation zone is `America/Argentina/Buenos_Aires`.

## Local bot transport (Phase 3B)

The bot is local-only. It uses Telegram long polling only when the operator starts it
manually from Windows PowerShell:

```powershell
npm.cmd run bot
```

Before that command, create `.env.local` yourself (it is ignored by Git) with the
two required values from `.env.example`: `TELEGRAM_BOT_TOKEN` and
`TELEGRAM_ALLOWED_CHAT_ID`. Do not paste them into chat, source control, or logs.
The program validates them locally without printing their values. No `.env.local` is
created automatically.

Each `/prompt` has a preview and explicit confirmation. The confirmed natural-language
request is supplied on standard input to a fixed `codex.exe exec` invocation with the
exact MediControl working directory, `workspace-write` sandbox, JSONL, and a fixed
JSON Schema. It never becomes a shell command, path, flag, or executable. The bot
supports `/status`, `/cancel`, and `/diff`; `/diff` runs only fixed local `git status`
and `git diff --stat` commands. Telegram polling acknowledges an update only after
handling it and stops cleanly on Ctrl+C. `REQUEST_TIMEOUT_MS` is configurable from
1000 to 60000 milliseconds and defaults to the 10000 value in `.env.example`; long
polling uses at least its poll timeout plus five seconds. Tests simulate
both Telegram and child processes; this phase does not contact Telegram, Codex, or
Notion during checks.

## Configuration

Copy values from `.env.example` manually only when a future phase explicitly needs
them. `.env.local` is ignored and must never be committed. The sample file contains no
credentials and uses empty values for all service identifiers.

## Scope boundary

This phase implements a fictional SQLite demonstration and a local, manually started
Telegram-to-Codex bridge. Notion, payments, deployment, webhooks, and arbitrary chat
command execution are out of scope. Operational and data-safety constraints are in
[`AGENTS.md`](AGENTS.md).
