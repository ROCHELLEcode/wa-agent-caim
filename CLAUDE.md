# CLAUDE.md — guía para Claude Code

Este repo es **wa-agent-starter**: un boilerplate para agentes de IA de WhatsApp. Node 20 + TypeScript (ESM). Está construido y testeado — tu rol es ayudar al usuario a **configurarlo, extenderlo y desplegarlo**, no reescribir el núcleo.

## Onboarding
Si el usuario quiere crear su agente desde cero, corré el comando `/build-agent`: te guía para entrevistarlo y dejar la config lista.

## Arquitectura (lo mínimo para orientarte)
- El **cerebro** (agente) es siempre el mismo. Lo que cambia por proyecto es el **canal** (por dónde entran los mensajes), las **herramientas** y la **personalidad**.
- `src/channels/` — adaptadores de canal (la abstracción clave, `ChannelAdapter`): `web`, `cloud-api`, `ghl` (completos), `chatwoot`, `ycloud` (stubs). Se elige con `CHANNEL_ADAPTER`.
- `src/agent/` — `runner.ts` (loop de tool-calling), `llm.ts` (OpenRouter), `prompt.ts`, `tools/`.
- `src/queue/` — buffer con debounce + worker (canales por webhook). El canal `web` procesa en línea, sin Redis.
- `src/memory/` — store: `postgres` o `memory` (elegido con `STORE`).
- `config/agent.yaml` — identidad y conocimiento del agente (editable por no-devs).

## Tareas comunes
- **Cambiar la personalidad** → editá `config/agent.yaml` (nada de código).
- **Agregar una herramienta** → copiá un archivo de `src/agent/tools/examples/`, definí `definition` + `run`, y sumalo a `defaultTools` en `src/agent/tools/index.ts`.
- **Agregar/terminar un canal** → implementá la interfaz de `src/channels/types.ts` y registralo en `src/channels/registry.ts`. Los stubs `chatwoot/` y `ycloud/` son plantillas.
- **Probar** → `npm run demo` (web) o `npm run chat` (terminal). Ambos corren sin Postgres ni WhatsApp.
- **Verificar** → `npm run typecheck` y `npm test`.

## Reglas
- No pongas secretos en el código ni los commitees; van en `.env` (gitignoreado).
- Mantené el estilo: identificadores en inglés, comentarios y docs en español.
- Antes de dar por hecho un cambio, corré `npm run typecheck` y `npm test`.
