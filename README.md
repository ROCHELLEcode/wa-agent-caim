# wa-agent-starter

Boilerplate para levantar **agentes de IA de WhatsApp** rápido y bien. La infraestructura de verdad — la que normalmente reescribís en cada proyecto — ya resuelta:

- 🧠 **Agente con tool-calling** (OpenRouter → cualquier modelo: Claude, GPT, Gemini…).
- 🔌 **Frontend pluggable**: WhatsApp Cloud API, GoHighLevel, Chatwoot, YCloud o tu propia app. Se elige con una variable.
- ⚡ **Cola con Redis + debounce**: junta los mensajitos sueltos, procesa un turno a la vez, webhooks idempotentes.
- 💾 **Memoria** persistente (Postgres) u opcional en RAM (para probar sin nada).
- 🚀 **Deploy en Coolify** con un comando.
- 🧪 **Demo con UI web** que corre sin configurar WhatsApp ni base de datos.

> Hecho para enseñar a construir agentes. Cada pieza está comentada y pensada para que la leas, la entiendas y la hagas tuya.

---

## Armá tu agente sin tocar código

### Con Claude Code (recomendado)

```bash
git clone https://github.com/diegovasquez-ai/wa-agent-starter.git
cd wa-agent-starter && npm install
claude            # abrí Claude Code y escribí:  /build-agent
```

`/build-agent` te **entrevista** (nombre del negocio, a qué se dedica, tono, horario, canal, tu API key de OpenRouter) y deja configurado `config/agent.yaml` + `.env`, listo para probar. No inventa código: solo completa la config de un agente ya construido y testeado — así podés confiar en lo que corre y encima *entenderlo*.

### Sin Claude Code

```bash
npm run setup     # la misma entrevista, por terminal
npm run demo      # abre http://localhost:3000  (o: npm run chat)
```

**¿Preferís a mano?** Copiá `.env.example` a `.env`, poné tu `OPENROUTER_API_KEY`, y editá [`config/agent.yaml`](config/agent.yaml). El código no cambia entre un agente y otro — solo ese archivo.

---

## Cómo funciona

```
   El usuario escribe
          │
          ▼
   ┌──────────────┐   El adaptador traduce el webhook de CADA plataforma
   │  ADAPTADOR   │   a un "mensaje normalizado". Elegís cuál con
   │  DE CANAL    │   CHANNEL_ADAPTER = cloud-api | ghl | chatwoot | ycloud | web
   └──────┬───────┘
          │  (canales por webhook)         (canal web)
          ▼                                     │
   Redis: buffer + debounce (8s)                │  inline, sin cola
          │                                     │
          ▼                                     ▼
   Worker (BullMQ)  ─────────►  Agente (runner con tool-calling)  ◄──── memoria (Postgres | RAM)
          │                            │
          │                     herramientas (config, APIs, RAG…)
          ▼
   Adaptador.sendOutbound → la respuesta vuelve por la misma plataforma
```

**La idea central:** el cerebro del agente es siempre el mismo. Lo que cambia entre un proyecto y otro es (a) el **canal** por donde entran los mensajes y (b) las **herramientas** y la **personalidad**. Todo lo demás lo reusás.

### El árbol

```
src/
├── index.ts              arranque: elige store + canal, levanta server (+ worker si hace falta)
├── server.ts             Fastify + health + monta las rutas del canal activo
├── env.ts                config del núcleo (zod, falla al arrancar si falta algo)
├── config.ts             carga config/agent.yaml (personalidad + conocimiento)
├── channels/             ← LA ABSTRACCIÓN CLAVE
│   ├── types.ts          interfaz ChannelAdapter + NormalizedMessage
│   ├── registry.ts       elige el adaptador por CHANNEL_ADAPTER
│   ├── ingest.ts         pipeline común: idempotencia, upsert, encolar / inline
│   ├── web/              UI de chat (demo + ejemplo de "tu app")     [completo]
│   ├── cloud-api/        WhatsApp Cloud API oficial (Meta)           [completo]
│   ├── ghl/              GoHighLevel                                 [completo]
│   ├── chatwoot/         Chatwoot                                    [stub + guía]
│   └── ycloud/           YCloud                                      [stub + guía]
├── agent/
│   ├── runner.ts         loop de tool-calling (el motor)
│   ├── llm.ts            cliente OpenRouter
│   ├── prompt.ts         arma el system prompt (identidad + contexto)
│   ├── args.ts           saneamiento de los argumentos del modelo
│   └── tools/            herramientas: index.ts (registro) + examples/
├── queue/                buffer (debounce) + worker + cola BullMQ
├── memory/               store: interfaz + Postgres + RAM (elegido por STORE)
└── db/                   pool, runner de migraciones, tipos
```

---

## Elegir tu canal

Poné `CHANNEL_ADAPTER` y completá sus variables (ver [`.env.example`](.env.example)).

| Canal | `CHANNEL_ADAPTER` | Qué necesitás | Estado |
|---|---|---|---|
| Web (demo / tu app) | `web` | nada | ✅ completo |
| WhatsApp Cloud API | `cloud-api` | `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN` | ✅ completo |
| GoHighLevel | `ghl` | `GHL_API_TOKEN`, `GHL_LOCATION_ID`, `WEBHOOK_SECRET` | ✅ completo |
| Chatwoot | `chatwoot` | (ver el stub) | 🧩 stub + guía |
| YCloud | `ycloud` | (ver el stub) | 🧩 stub + guía |

**El webhook** de cada canal se monta en `/webhooks/<canal>` (p.ej. `/webhooks/cloud-api`). Apuntá ahí la plataforma.

### Agregar un canal nuevo

Es una sola cosa: implementar la interfaz [`ChannelAdapter`](src/channels/types.ts) (`registerRoutes`, `sendOutbound`) y registrarlo en [`registry.ts`](src/channels/registry.ts). Los stubs de [`chatwoot/`](src/channels/chatwoot/adapter.ts) y [`ycloud/`](src/channels/ycloud/adapter.ts) son plantillas comentadas — copiá una y completala.

---

## Agregar una herramienta

Copiá un ejemplo de [`src/agent/tools/examples/`](src/agent/tools/examples/), definí su `definition` (lo que ve el modelo) y su `run` (lo que hace), y sumala al array `defaultTools` de [`tools/index.ts`](src/agent/tools/index.ts). El runner se encarga del resto (dispatch, persistencia, manejo de errores).

---

## Con persistencia y WhatsApp real (local)

```bash
docker compose up -d          # Postgres + Redis
cp .env.example .env          # STORE=postgres, CHANNEL_ADAPTER=cloud-api, credenciales…
npm run migrate
npm run dev
```

Exponé `http://localhost:3000` con un túnel (ngrok, cloudflared) y apuntá el webhook del proveedor a `https://…/webhooks/<canal>`.

---

## Deploy en Coolify

1. **New Resource → Docker Compose**, apuntá al repo, archivo `/docker-compose.coolify.yml`.
2. Cargá las variables de entorno en el panel (o usá `npm run deploy`, que lo automatiza por API — necesita `COOLIFY_URL`, `COOLIFY_API_TOKEN`, `GITHUB_TOKEN`, `GITHUB_REPO` en el `.env`).
3. Asigná el dominio al servicio `app`, puerto 3000. Coolify pone el TLS.
4. Las migraciones corren solas al arrancar (si `STORE=postgres`).
5. Verificá: `curl https://TU-DOMINIO/health/ready`.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run setup` | Entrevista y arma tu agente (config/agent.yaml + .env). |
| `npm run demo` | Server con canal web + memoria RAM. Abrí el navegador. |
| `npm run chat` | Chat por terminal contra el agente. |
| `npm run dev` | Server con hot reload (usa tu `.env`). |
| `npm run migrate` | Aplica las migraciones (si usás Postgres). |
| `npm run build` / `npm start` | Compila / corre compilado. |
| `npm test` | Tests unitarios. |
| `npm run typecheck` | Chequeo de tipos. |
| `npm run deploy` | Deploy a Coolify por API. |

---

## Notas de diseño

- **OpenRouter** de una sola credencial para cualquier modelo. Cambiás `LLM_MODEL` y listo.
- **Idempotencia**: los proveedores reintentan; cada evento se procesa una vez (por id de mensaje o uno sintético).
- **Un turno a la vez** por conversación (lock en Redis): nunca dos respuestas cruzadas.
- **`AGENT_REPLY_ENABLED=false`** corre el agente sin enviar — para los primeros días en producción.
- El manejo de **audio/imágenes** no viene en el núcleo (v1 es texto). El punto para extenderlo está marcado en el adaptador `cloud-api`.

## Licencia

MIT.
