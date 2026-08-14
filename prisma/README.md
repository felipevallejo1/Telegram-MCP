# Prisma local

Prisma guarda solo datos ficticios de MediControl y el estado local de solicitudes
del bot. Las pruebas usan `prisma/test.db`; las bases SQLite generadas estan ignoradas
por Git. No se guardan tokens de Telegram, credenciales, salidas crudas de Codex ni
datos personales.

Fase 3B no integra Notion ni crea conexiones externas desde Prisma.
