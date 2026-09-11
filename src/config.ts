import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Personalidad y conocimiento del agente, en un YAML editable por no-devs.
 * Toda la "identidad" del bot vive en config/agent.yaml — el código no cambia
 * entre un agente y otro, solo este archivo.
 */
const mediaItemSchema = z.object({
  url: z.string(),
  type: z.enum(['image', 'video']),
  caption: z.string().optional(),
});

const productSchema = z.object({
  key: z.string(),
  media: z.array(mediaItemSchema).default([]),
});

const schema = z.object({
  name: z.string().default('Asistente'),
  system_prompt: z.string().min(1, 'Falta system_prompt en agent.yaml'),
  greeting: z.string().optional(),
  knowledge: z.array(z.string()).default([]),
  products: z.array(productSchema).default([]),
});

export type AgentConfig = z.infer<typeof schema>;

let cached: AgentConfig | null = null;

export function loadConfig(): AgentConfig {
  if (cached) return cached;

  const file = path.resolve(process.cwd(), env.AGENT_CONFIG_PATH);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    logger.error({ file }, 'no se encontró el archivo de configuración del agente (AGENT_CONFIG_PATH)');
    process.exit(1);
  }

  const parsed = schema.safeParse(parse(raw));
  if (!parsed.success) {
    const detalle = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    logger.error(`agent.yaml inválido:\n${detalle}`);
    process.exit(1);
  }

  cached = parsed.data;
  return cached;
}
