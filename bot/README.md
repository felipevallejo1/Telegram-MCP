# Bot local (Fase 3B)

El entrypoint queda inerte cuando se importa. Solo inicia long polling al ejecutar
manualmente `npm.cmd run bot` en Windows PowerShell. No hay webhook ni servicio
hospedado. Cada update se confirma solo despues de procesarse; errores transitorios
usan reintentos limitados con backoff y Ctrl+C cierra el polling ordenadamente.

Antes de esa primera prueba real, el operador crea `.env.local` de forma local con
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID` y `NOTION_PARENT_PAGE`. Los valores
se leen sin mostrarse y nunca se solicitan, crean ni guardan mediante chat.

Una solicitud confirmada usa solamente `codex.exe exec` con argumentos separados,
sin shell, directorio fijo de MediControl, sandbox `workspace-write`, JSONL y un
JSON Schema fijo. El texto llega por stdin y no controla ejecutable, argumentos ni
rutas. El resultado estructurado temporal se guarda solamente en `.codex/runs/` y se
elimina tras exito, fallo, timeout o cancelacion. Timeout, cancelacion y terminacion
del arbol de procesos emplean mecanismos fijos de Windows. `/diff` ejecuta solamente
`git.exe status --short --untracked-files=all` y `git.exe diff --no-ext-diff --stat -- .`
con argumentos fijos. Las notificaciones muestran resumen, archivos relativos,
verificaciones y advertencias validadas, pero nunca secretos ni salida cruda. Una
tarea con verificaciones fallidas queda `FAILED` aunque haya aplicado archivos.

`/modelo` selecciona Luna, Terra o Sol y el nivel de razonamiento para las tareas
siguientes. `/pregunta` clasifica la consulta con Codex, pero ejecuta solamente una
metrica agregada predefinida y de solo lectura sobre la base ficticia; el texto de
Telegram nunca se convierte en SQL. `/documentar` requiere ademas una confirmacion
explicita y usa el MCP oficial de Notion contra la pagina fija del proyecto. Un
`/prompt` completado nunca inicia documentacion automaticamente.

Tras un reinicio, una solicitud `RUNNING` queda fallida y una `CONFIRMED` queda
cancelada de forma conservadora; reenviá y confirmá nuevamente la solicitud para no
repetir cambios ambiguos.
