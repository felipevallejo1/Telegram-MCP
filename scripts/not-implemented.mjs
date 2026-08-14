const command = process.argv[2] ?? "unknown";

console.error(
  `[MediControl] ${command} is intentionally unavailable during Phase 0. ` +
    "No database, bot, or external integration has been implemented yet."
);
process.exitCode = 1;
