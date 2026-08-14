# MediControl operational boundaries

## Scope and data

- This repository is a demonstration environment. Use only invented, non-identifying data.
- Do not add, request, store, transmit, or infer real personal data, clinical histories, diagnoses, symptoms, prescriptions, payments, insurance, or medical records.
- Do not create `.env.local`, credentials, tokens, API keys, or other secrets. Keep only safe examples in `.env.example`.

## Operational restrictions

- Read and write only within this project unless the user explicitly authorizes a specific external path.
- Do not push, deploy, configure remotes, publish packages, or contact external services without explicit approval.
- Do not perform mass deletion, destructive resets, or broad filesystem operations.
- Telegram must never execute arbitrary commands, shell commands, code, filesystem operations, or external actions supplied by a chat message.

## Delivery

- Keep changes small and verifiable. Preserve concurrent edits and do not revert unrelated work.
- Before claiming completion, run the relevant local checks and report the actual command and result.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
