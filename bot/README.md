# Bot local (Fase 3B)

El entrypoint queda inerte cuando se importa. Solo inicia long polling al ejecutar
manualmente `npm.cmd run bot` en Windows PowerShell. No hay webhook ni servicio
hospedado. Cada update se confirma solo despues de procesarse; errores transitorios
usan reintentos limitados con backoff y Ctrl+C cierra el polling ordenadamente.

Antes de esa primera prueba real, el operador crea `.env.local` de forma local con
`TELEGRAM_BOT_TOKEN` y `TELEGRAM_ALLOWED_CHAT_ID`. Ambos valores son obligatorios,
se validan sin mostrarse y nunca se solicitan, crean ni guardan mediante chat.

Una solicitud confirmada usa solamente `codex.exe exec` con argumentos separados,
sin shell, directorio fijo de MediControl, sandbox `workspace-write`, JSONL y un
JSON Schema fijo. El texto llega por stdin y no controla ejecutable, argumentos ni
rutas. El resultado estructurado temporal se guarda solamente en `.codex/runs/` y se
elimina tras exito, fallo, timeout o cancelacion. Timeout, cancelacion y terminacion
del arbol de procesos emplean mecanismos fijos de Windows. `/diff` ejecuta solamente
`git.exe status --short --untracked-files=all` y `git.exe diff --no-ext-diff --stat -- .`
con argumentos fijos. Las notificaciones muestran estados y conteos allowlisted,
nunca prompts, rutas, secretos ni salida cruda.

Esta fase no integra Notion. No inicies el comando hasta completar la configuracion
local y querer probar Telegram de verdad.

Tras un reinicio, una solicitud `RUNNING` queda fallida y una `CONFIRMED` queda
cancelada de forma conservadora; reenviá y confirmá nuevamente la solicitud para no
repetir cambios ambiguos.
