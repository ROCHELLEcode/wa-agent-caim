import { config } from 'dotenv';
import { z } from 'zod';

// override: true a propósito. Por defecto dotenv NO pisa variables que ya
// existan en el entorno, así que una key vieja exportada a nivel sistema le
// ganaría en silencio a la del .env. El .env es la fuente de verdad en local.
// En producción es inofensivo: no hay .env dentro del contenedor.
config({ override: true });

/**
 * Configuración del NÚCLEO. Cada adaptador de canal valida sus propias
 * variables por separado (ver src/channels/<canal>/env.ts), así el kit no
 * exige credenciales de canales que no vas a usar.
 *
 * Si algo falta o viene mal, el proceso muere al arrancar con un mensaje claro,
 * en vez de fallar a mitad de una conversación.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Persistencia. 'memory' = todo en RAM (demo, cero configuración).
    // 'postgres' = historial persistente (necesita DATABASE_URL).
    STORE: z.enum(['memory', 'postgres']).default('memory'),
    DATABASE_URL: z.string().url().optional(),

    // Cola de mensajes. Solo la usan los canales por webhook (Cloud API, GHL…).
    // El canal 'web' y el chat de terminal procesan en línea, sin Redis.
    REDIS_URL: z.string().url().default('redis://localhost:6379'),

    // Qué frontend está activo. Ver src/channels/registry.ts.
    CHANNEL_ADAPTER: z.enum(['web', 'cloud-api', 'ghl', 'chatwoot', 'ycloud']).default('web'),

    // Secreto compartido para validar webhooks (los canales que lo usan).
    WEBHOOK_SECRET: z.string().optional(),

    // ── LLM (OpenRouter) ──────────────────────────────────────
    OPENROUTER_API_KEY: z.string().min(1, 'Falta la API key de OpenRouter'),
    OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
    LLM_MODEL: z.string().default('anthropic/claude-sonnet-4.5'),
    LLM_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.3),
    APP_URL: z.string().default(''),
    APP_TITLE: z.string().default('wa-agent-starter'),

    // ── Agente ────────────────────────────────────────────────
    AGENT_CONFIG_PATH: z.string().default('config/agent.yaml'),
    MESSAGE_DEBOUNCE_MS: z.coerce.number().int().nonnegative().default(8_000),
    AGENT_MAX_TOOL_ITERATIONS: z.coerce.number().int().positive().default(6),
    AGENT_HISTORY_LIMIT: z.coerce.number().int().positive().default(40),
    AGENT_REPLY_ENABLED: z
      .string()
      .default('true')
      .transform((v) => v.toLowerCase() !== 'false'),
  })
  .refine((e) => e.STORE !== 'postgres' || Boolean(e.DATABASE_URL), {
    message: 'STORE=postgres requiere DATABASE_URL',
    path: ['DATABASE_URL'],
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detalle = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Configuración inválida. Revisá tu .env:\n${detalle}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
