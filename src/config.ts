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

/**
 * Catálogo estructurado (capacidad/precio/línea). Separado de `knowledge`
 * (que es texto libre) para que la búsqueda de precio por capacidad sea un
 * cálculo exacto en código (herramienta buscar_modelo), no una búsqueda de
 * texto — con texto libre, una consulta vaga ("el más grande", capacidades
 * escritas en palabras) podía devolver el precio de otro modelo.
 */
const modeloSchema = z.object({
  key: z.string(),
  linea: z.string(),
  capacidad: z.number(),
  precio: z.number(),
  fullAutomatica: z.boolean().default(false),
  agotado: z.boolean().default(false),
  /** La garantía general es 12 meses (1 año) — algunos modelos tienen una
   * garantía distinta (ej. la línea OVNI son 6 meses), así que es un campo
   * por modelo en vez de un dato fijo en el texto del prompt. */
  garantiaMeses: z.number().default(12),
});

// Exportado solo para tests (config.test.ts) — valida el cruce
// catalogo/products sin pasar por el filesystem ni por el caché de loadConfig.
export const schema = z
  .object({
    name: z.string().default('Asistente'),
    system_prompt: z.string().min(1, 'Falta system_prompt en agent.yaml'),
    greeting: z.string().optional(),
    knowledge: z.array(z.string()).default([]),
    products: z.array(productSchema).default([]),
    catalogo: z.array(modeloSchema).default([]),
  })
  // Bug real encontrado: antes, un typo en catalogo[].key (que no matchea
  // ningún products[].key) no fallaba acá — buscarModelo.ts hacía
  // `products.find(p => p.key === modelo.key)`, no encontraba nada, y el
  // bot mandaba el precio por texto SIN fotos para ese modelo, en silencio,
  // sin ningún error en los logs. Mejor que truene al arrancar (mensaje
  // claro) a que se descubra semanas después por una queja de un cliente.
  .superRefine((cfg, ctx) => {
    const productKeys = new Set(cfg.products.map((p) => p.key));
    const vistosProducts = new Set<string>();
    for (const [i, p] of cfg.products.entries()) {
      if (vistosProducts.has(p.key)) {
        ctx.addIssue({ code: 'custom', path: ['products', i, 'key'], message: `products.key duplicada: "${p.key}"` });
      }
      vistosProducts.add(p.key);
    }

    const vistosCatalogo = new Set<string>();
    for (const [i, m] of cfg.catalogo.entries()) {
      if (vistosCatalogo.has(m.key)) {
        ctx.addIssue({ code: 'custom', path: ['catalogo', i, 'key'], message: `catalogo.key duplicada: "${m.key}"` });
      }
      vistosCatalogo.add(m.key);
      if (!productKeys.has(m.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['catalogo', i, 'key'],
          message: `catalogo.key "${m.key}" no tiene ningún products.key que coincida — ese modelo nunca va a mandar fotos/videos`,
        });
      }
    }
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
