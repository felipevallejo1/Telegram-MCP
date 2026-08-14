# Tests

`npm.cmd run test` applies the local Prisma test migration and runs the Vitest suite.
Telegram, Codex, Git child processes, and lifecycle shutdown are represented by fakes;
the tests do not contact external services or require `.env.local`.
