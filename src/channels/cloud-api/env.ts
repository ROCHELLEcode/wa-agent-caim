import { z } from 'zod';

/**
 * Variables del canal WhatsApp Cloud API (Meta). Se validan solo si este canal
 * está activo (el registry lo importa recién ahí).
 *
 * De dónde salen: Meta for Developers → tu app → WhatsApp → API Setup.
 */
const schema = z.object({
  META_ACCESS_TOKEN: z.string().min(1, 'Falta META_ACCESS_TOKEN'),
  META_PHONE_NUMBER_ID: z.string().min(1, 'Falta META_PHONE_NUMBER_ID'),
  // El "Verify token" que inventás y ponés igual en el dashboard de Meta.
  META_VERIFY_TOKEN: z.string().min(1, 'Falta META_VERIFY_TOKEN'),
  // App Secret: si lo ponés, validamos la firma HMAC de cada webhook.
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default('v20.0'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const detalle = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Config de Cloud API inválida:\n${detalle}`);
  process.exit(1);
}

export const cloudEnv = parsed.data;
