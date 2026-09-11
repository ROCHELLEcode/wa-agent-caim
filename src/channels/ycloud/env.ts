import { z } from 'zod';

/**
 * Variables del canal YCloud. Se validan solo si este canal está activo (el
 * registry lo importa recién ahí).
 *
 * De dónde salen:
 *   YCLOUD_API_KEY       → YCloud dashboard → API Keys.
 *   YCLOUD_FROM_NUMBER   → tu número de WhatsApp Business en YCloud, formato
 *                          E.164 (ej: +51987654321).
 *   YCLOUD_WEBHOOK_SECRET→ YCloud → Developers → Webhooks → el "secret" que te
 *                          da al crear el endpoint. Opcional pero recomendado:
 *                          si lo ponés, se valida la firma de cada webhook.
 */
const schema = z.object({
  YCLOUD_API_KEY: z.string().min(1, 'Falta YCLOUD_API_KEY'),
  YCLOUD_FROM_NUMBER: z.string().min(1, 'Falta YCLOUD_FROM_NUMBER'),
  YCLOUD_WEBHOOK_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const detalle = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Config de YCloud inválida:\n${detalle}`);
  process.exit(1);
}

export const ycloudEnv = parsed.data;
