import type { FastifyInstance } from 'fastify';
import { logger } from '../../logger.js';
import type { ChannelAdapter, ChannelContext, NormalizedMessage, SendOutboundInput } from '../types.js';

const WEBHOOK_PATH = '/webhooks/chatwoot';

/**
 * ┌───────────────────────────────────────────────────────────┐
 * │  STUB — Chatwoot. Esqueleto para que lo completes.         │
 * └───────────────────────────────────────────────────────────┘
 *
 * Chatwoot es un frontend open-source de atención. Conectás WhatsApp a Chatwoot,
 * y Chatwoot te avisa por webhook. Para terminarlo:
 *
 * 1. En Chatwoot: Settings → Integrations → Webhooks → agregá
 *      https://TU-DOMINIO/webhooks/chatwoot   (evento: message_created)
 * 2. Env vars (agregá su validación en un env.ts como el de cloud-api):
 *      CHATWOOT_BASE_URL, CHATWOOT_API_TOKEN, CHATWOOT_ACCOUNT_ID
 * 3. Completá parseInbound (abajo) y sendOutbound (más abajo).
 */
export const chatwootAdapter: ChannelAdapter = {
  name: 'chatwoot',
  mode: 'queue',

  registerRoutes(app: FastifyInstance, ctx: ChannelContext): void {
    logger.warn('canal chatwoot: STUB. Completá parseInbound/sendOutbound en src/channels/chatwoot/adapter.ts');
    app.post(WEBHOOK_PATH, async (request, reply) => {
      const message = parseInbound(request.body);
      if (message) await ctx.enqueue(message);
      return reply.code(200).send({ ok: true });
    });
  },

  async sendOutbound(_input: SendOutboundInput): Promise<{ messageId?: string }> {
    // TODO: POST {CHATWOOT_BASE_URL}/api/v1/accounts/{ACCOUNT_ID}/conversations/{conversationId}/messages
    //   headers: { api_access_token: CHATWOOT_API_TOKEN }
    //   body: { content: input.text, message_type: 'outgoing' }
    // Chatwoot envía por conversación → usá input.externalConversationId.
    throw new Error('chatwoot.sendOutbound sin implementar (ver comentarios del archivo)');
  },
};

/**
 * Chatwoot manda `message_created`. El texto está en `content`, el contacto en
 * `sender`, la conversación en `conversation.id`. Filtrá los salientes
 * (message_type === 'incoming'). Ajustá los campos a tu instancia.
 */
function parseInbound(payload: unknown): NormalizedMessage | null {
  const p = payload as {
    event?: string;
    message_type?: string;
    content?: string;
    sender?: { id?: number | string; name?: string; phone_number?: string };
    conversation?: { id?: number | string };
  };
  if (p?.event !== 'message_created' || p?.message_type !== 'incoming') return null;

  const text = typeof p.content === 'string' ? p.content.trim() : '';
  const contactId = p.sender?.id != null ? String(p.sender.id) : null;
  if (!text || !contactId) return null;

  return {
    externalContactId: contactId,
    externalConversationId: p.conversation?.id != null ? String(p.conversation.id) : null,
    text,
    name: p.sender?.name ?? null,
    phone: p.sender?.phone_number ?? null,
    isInbound: true,
  };
}
