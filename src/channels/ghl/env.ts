import { z } from 'zod';

/**
 * Variables del canal GoHighLevel. De dónde salen: Settings → Private
 * Integrations (token), y el location id de tu sub-cuenta.
 *
 * El secreto del webhook es el WEBHOOK_SECRET del núcleo: lo mandás como header
 * `x-webhook-secret` desde el workflow de GHL.
 */
const schema = z.object({
  GHL_API_TOKEN: z.string().min(1, 'Falta GHL_API_TOKEN'),
  GHL_LOCATION_ID: z.string().min(1, 'Falta GHL_LOCATION_ID'),
  GHL_API_BASE: z.string().url().default('https://services.leadconnectorhq.com'),
  GHL_API_VERSION: z.string().default('2021-07-28'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const detalle = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Config de GHL inválida:\n${detalle}`);
  process.exit(1);
}

export const ghlEnv = parsed.data;
