import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { logger } from '../../logger.js';
import { requestJson } from '../../integrations/http.js';
import { safeEqual } from '../../security.js';
import type { RequestWithRawBody } from '../../server.js';
import type { ChannelAdapter, ChannelContext, NormalizedMessage, SendOutboundInput } from '../types.js';
import { ycloudEnv } from './env.js';

const WEBHOOK_PATH = '/webhooks/ycloud';

/**
 * Comandos manuales: los escribís vos mismo, desde la app de WhatsApp
 * Business, en la conversación con el cliente. Sirven para pausar o
 * reanudar el agente en ESA conversación puntual (por ejemplo, si vas a
 * responder vos directamente y no querés que el bot también conteste).
 *
 * OJO: como los escribís en el chat real, el cliente los va a ver como un
 * mensaje tuyo. Podés borrarlos después ("eliminar para todos") si querés.
 */
const AGENT_CONTROL_COMMANDS: Record<string, boolean> = {
  '/pausa': false,
  '/reanudar': true,
};

/**
 * Adaptador de YCloud (proveedor de la WhatsApp Business API).
 *
 * Configuración en YCloud: Developers → Webhooks → agregá
 *   https://TU-DOMINIO/webhooks/ycloud   (evento: whatsapp.inbound_message.received)
 * y copiá el "secret" que te dan a YCLOUD_WEBHOOK_SECRET.
 *
 * Docs: https://docs.ycloud.com/ (WhatsApp Messages API + Webhooks).
 */
export const ycloudAdapter: ChannelAdapter = {
  name: 'ycloud',
  mode: 'queue',

  registerRoutes(app: FastifyInstance, ctx: ChannelContext): void {
    app.post(WEBHOOK_PATH, async (request, reply) => {
      if (ycloudEnv.YCLOUD_WEBHOOK_SECRET) {
        const raw = (request as RequestWithRawBody).rawBody ?? Buffer.from('');
        if (!ycloudSignatureValid(raw, request.headers['ycloud-signature'], ycloudEnv.YCLOUD_WEBHOOK_SECRET)) {
          logger.warn('webhook ycloud rechazado: firma inválida');
          return reply.code(401).send({ error: 'firma inválida' });
        }
      }

      // Eco de un mensaje que EL DUEÑO escribió a mano en la app de WhatsApp
      // (coexistencia). Lo tratamos como comando de control (/pausa,
      // /reanudar), nunca lo mandamos al agente.
      const control = parseAgentControl(request.body);
      if (control) {
        await applyAgentControl(control, ctx);
        return reply.code(200).send({ ok: true });
      }

      const message = parseInbound(request.body);
      if (message) await ctx.enqueue(message);
      // Respondemos 200 rápido: YCloud reintenta si tardamos o si fallamos.
      return reply.code(200).send({ ok: true });
    });

    logger.info({ path: WEBHOOK_PATH }, 'canal ycloud listo');
  },

  async sendOutbound({ externalContactId, text, media }: SendOutboundInput): Promise<{ messageId?: string }> {
    let lastId: string | undefined;

    // Primero las fotos/videos (si hay), después el texto de la respuesta.
    for (const item of media ?? []) {
      const res = await sendYCloudMessage({
        to: externalContactId,
        type: item.type,
        payload: { link: item.url, ...(item.caption ? { caption: item.caption } : {}) },
      });
      lastId = res.whatsappMessage?.id ?? res.id ?? lastId;
    }

    if (text) {
      const res = await sendYCloudMessage({ to: externalContactId, type: 'text', payload: { body: text } });
      lastId = res.whatsappMessage?.id ?? res.id ?? lastId;
    }

    return { messageId: lastId };
  },
};

async function sendYCloudMessage(input: {
  to: string;
  type: 'text' | 'image' | 'video';
  payload: Record<string, unknown>;
}): Promise<{ id?: string; whatsappMessage?: { id?: string } }> {
  return requestJson<{ id?: string; whatsappMessage?: { id?: string } }>(
    'https://api.ycloud.com/v2/whatsapp/messages/sendDirectly',
    {
      method: 'POST',
      headers: { 'X-API-Key': ycloudEnv.YCLOUD_API_KEY },
      body: {
        from: ycloudEnv.YCLOUD_FROM_NUMBER,
        to: input.to,
        type: input.type,
        [input.type]: input.payload,
      },
      context: `ycloud.send.${input.type}`,
    },
  );
}

/**
 * Verifica el header `YCloud-Signature: t={timestamp},s={signature}`.
 * La firma es HMAC-SHA256 sobre `${timestamp}.${rawBody}` con el secret del
 * webhook. Ver: https://docs.ycloud.com/reference/webhook-integration-guide
 */
function ycloudSignatureValid(raw: Buffer, header: unknown, secret: string): boolean {
  if (typeof header !== 'string') return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k?.trim(), v?.trim()];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.s;
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${raw.toString('utf8')}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return safeEqual(signature, expected);
}

/**
 * YCloud manda el mensaje en `whatsappInboundMessage`. Solo procesamos texto
 * por ahora (ver notas de diseño del README sobre audio/imágenes).
 */
function parseInbound(payload: unknown): NormalizedMessage | null {
  const p = payload as {
    type?: string;
    whatsappInboundMessage?: {
      id?: string;
      from?: string;
      type?: string;
      text?: { body?: string };
      customerProfile?: { name?: string };
    };
  };
  const m = p?.whatsappInboundMessage;
  if (!m?.from) return null;

  const text = m.type === 'text' ? (m.text?.body ?? '').trim() : '';
  if (!text) return null;

  return {
    externalContactId: m.from,
    externalMessageId: m.id ?? null,
    text,
    phone: m.from,
    name: m.customerProfile?.name ?? null,
    isInbound: true,
  };
}

interface AgentControlCommand {
  externalContactId: string;
  enable: boolean;
}

/**
 * Detecta /pausa y /reanudar en el evento de eco `whatsapp.smb.message.echoes`
 * (mensajes que vos mandaste a mano desde la app, no vía la API). Cualquier
 * otro texto tuyo (una respuesta normal a un cliente) devuelve null y sigue
 * de largo sin tocar nada — por eso son comandos exactos y no "cualquier
 * mensaje tuyo pausa el bot": así no hay riesgo de pausar por accidente.
 */
function parseAgentControl(payload: unknown): AgentControlCommand | null {
  const p = payload as {
    type?: string;
    whatsappMessage?: { to?: string; text?: { body?: string } };
  };
  if (p?.type !== 'whatsapp.smb.message.echoes') return null;

  const to = p.whatsappMessage?.to;
  const body = (p.whatsappMessage?.text?.body ?? '').trim().toLowerCase();
  if (!to || !(body in AGENT_CONTROL_COMMANDS)) return null;

  return { externalContactId: to, enable: AGENT_CONTROL_COMMANDS[body]! };
}

async function applyAgentControl(command: AgentControlCommand, ctx: ChannelContext): Promise<void> {
  const contact = await ctx.store.upsertContact({ externalId: command.externalContactId });
  const conversation = await ctx.store.getOrCreateConversation(contact.id);
  await ctx.store.setAgentEnabled(conversation.id, command.enable);
  logger.info(
    { to: command.externalContactId, enabled: command.enable },
    `ycloud: agente ${command.enable ? 'reanudado' : 'pausado'} a mano en esta conversación`,
  );
}
