# Telegram MCP

Este proyecto nació como una prueba para controlar Codex desde Telegram y poder
documentar los cambios en Notion usando MCP.

La idea es sencilla: dejo el proyecto abierto en mi computadora, inicio el bot y
desde Telegram puedo pedir un cambio. El bot recibe el mensaje, me muestra lo que
va a ejecutar y espera mi confirmación. Recién entonces llama a Codex para que
trabaje sobre los archivos locales.

Como ejemplo usé **MediControl**, una aplicación web de turnos médicos hecha con
Next.js y una base de datos SQLite. Tiene pacientes, especialistas, horarios y
reservas, así que permite ver fácilmente los cambios que Codex realiza.

## Cómo funciona

```text
Telegram -> Bot local -> Codex CLI -> Proyecto MediControl
                         |
                         +-> Notion MCP, solamente cuando se pide documentar
```

El bot funciona mediante *long polling*, por lo que no necesita publicar un
servidor ni abrir un puerto de la computadora. Mientras el proceso local está
encendido, consulta a Telegram por mensajes nuevos.

Los pedidos no se ejecutan directamente como comandos de consola. El bot valida
el chat, prepara la tarea y pide una confirmación antes de enviarla a Codex. También
permite elegir el modelo y el nivel de razonamiento desde Telegram.

La documentación en Notion no es automática. Después de terminar un cambio hay
que usar `/documentar` y confirmar la acción. En ese momento Codex utiliza el MCP
oficial de Notion para escribir un resumen en la página configurada.

## Comandos del bot

- `/prompt <pedido>`: solicita un cambio en el proyecto.
- `/pregunta <consulta>`: responde consultas permitidas sobre la base de datos.
- `/modelo`: permite elegir el modelo y el nivel de razonamiento.
- `/status`: muestra si el bot está libre, ejecutando o documentando.
- `/diff`: resume los archivos modificados.
- `/documentar`: prepara la documentación del último trabajo en Notion.
- `/cancel`: cancela una tarea pendiente.
- `/help`: muestra la ayuda disponible.

## Tecnologías utilizadas

- Next.js, React y TypeScript para la aplicación web.
- Prisma y SQLite para los datos de MediControl.
- Node.js para el bot local.
- Telegram Bot API para recibir mensajes.
- Codex CLI para ejecutar las tareas sobre el proyecto.
- Model Context Protocol y Notion para documentar los cambios.
- Vitest y ESLint para las verificaciones.

## Cómo levantar el proyecto

Se necesita Node.js 22 o una versión posterior.

```powershell
npm.cmd install
npm.cmd run db:reset
npm.cmd run dev
```

La web queda disponible en `http://localhost:3000`.

Para iniciar el bot, se abre otra terminal y se ejecuta:

```powershell
npm.cmd run bot
```

Antes de iniciarlo hay que copiar `.env.example` como `.env.local` y completar las
variables locales de Telegram y Notion. Ese archivo está ignorado por Git y no debe
subirse al repositorio.

## Verificaciones

```powershell
npm.cmd run test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

En resumen, el proyecto conecta tres partes: Telegram como control remoto, Codex
como agente que trabaja en la computadora y Notion MCP como destino opcional para
la documentación.
