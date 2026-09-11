import type { FastifyInstance } from 'fastify';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { requestJson } from '../../integrations/http.js';
import { sharedSecretValid } from '../../security.js';
import type { ChannelAdapter, ChannelContext, SendOutboundInput } from '../types.js';
import { ghlEnv } from './env.js';
import { parseInbound } from './parse.js';

const WEBHOOK_PATH = '/webhooks/ghl';

/**
 * Adaptador de GoHighLevel. GHL es el CRM/frontend; los mensajes de WhatsApp
 * entran por un Workflow que llama a nuestro webhook, y salen por la API de
 * conversaciones.
 *
 * En GHL: Automation → Workflows → Trigger "Customer Replied" (canal WhatsApp)
 *   → Acción "Webhook":
 *     POST https://TU-DOMINIO/webhooks/ghl
 *     Header: x-webhook-secret = <tu WEBHOOK_SECRET>
 *     Body (custom data): contactId = {{contact.id}}, body = {{message.body}}
 */
export const ghlAdapter: ChannelAdapter = {
  name: 'ghl',
  mode: 'queue',

  registerRoutes(app: FastifyInstance, ctx: ChannelContext): void {
    app.post(WEBHOOK_PATH, async (request, reply) => {
      if (!sharedSecretValid(request.headers['x-webhook-secret'], env.WEBHOOK_SECRET)) {
        return reply.code(401).send({ error: 'no autorizado' });
      }
      const message = parseInbound(request.body);
      if (message) await ctx.enqueue(message);
      // 200 aunque el payload venga incompleto: un 4xx haría reintentar para siempre.
      return reply.code(200).send({ ok: true });
    });

    logger.info({ path: WEBHOOK_PATH }, 'canal ghl listo');
  },

  async sendOutbound({ externalContactId, text }: SendOutboundInput): Promise<{ messageId?: string }> {
    const res = await requestJson<{ messageId?: string }>(`${ghlEnv.GHL_API_BASE}/conversations/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ghlEnv.GHL_API_TOKEN}`, Version: ghlEnv.GHL_API_VERSION },
      body: { type: 'WhatsApp', contactId: externalContactId, message: text },
      context: 'ghl.send',
    });
    return { messageId: res.messageId };
  },
};
