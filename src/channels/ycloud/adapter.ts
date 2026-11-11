import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { logger } from '../../logger.js';
import { requestJson } from '../../integrations/http.js';
import { safeEqual } from '../../security.js';
import type { RequestWithRawBody } from '../../server.js';
import type { ChannelAdapter, ChannelContext, NormalizedMessage, SendOutboundInput } from '../types.js';
import { ycloudEnv } from './env.js';

const WEBHOOK_PATH = '/webhooks/ycloud';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  '/nn': false,
  '/ss': true,
};

/**
 * Comandos de envío directo: mandan TODO el contenido de una key de
 * `products` (config/agent.yaml) al cliente de esa conversación, sin pasar
 * por la IA — ni gasta tokens ni depende de que el modelo "se acuerde" de
 * llamar a varias herramientas. Pensado para catálogos grandes (fotos +
 * videos) que querés mandar de una con un solo comando corto.
 */
const MEDIA_COMMANDS: Record<string, string> = {
  '/inku': 'catalogo_general',
  '/fp': 'metodos_pago',
  '/dd': 'ubicacion',
  '/sh': 'shalom_videos',
  '/tutorcaim': 'tutorial_56_rcaim',
  '/tutomicro': 'tutorial_microplus',
  '/tuto12hhd': 'tutorial_12hhd',
  '/tuto36': 'tutorial_36',
  '/tutometal': 'tutorial_metal',
  '/inforcaim': 'info_56rcaim',
  '/infometal2': 'info_catalogometal',
  '/info24': 'info_24',
  '/info12': 'info_12',
  '/info6': 'info_06',
  '/infopiedra1': 'info_piedra64',
  '/infopiedra2': 'info_piedra2',
  '/infometal': 'info_metal',
  '/info128': 'info_piedra128',
  '/csb': 'pruebas_csb',
  '/tuto1056': 'tutorial_1056',
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
      // (coexistencia). Lo tratamos como comando de control (/nn,
      // /ss), nunca lo mandamos al agente.
      const control = parseAgentControl(request.body);
      if (control) {
        await applyAgentControl(control, ctx);
        return reply.code(200).send({ ok: true });
      }

      // Comando de envío directo (ej. /inku): manda todo el contenido de una
      // key de products al cliente, también sin pasar por el agente. No lo
      // esperamos: catálogos grandes tardan varios segundos (hay una pausa
      // entre cada archivo) y si YCloud no recibe el 200 a tiempo, reintenta
      // el webhook — lo que duplicaría el envío completo.
      const mediaCommand = parseMediaCommand(request.body);
      if (mediaCommand) {
        sendMediaCommand(mediaCommand, ctx).catch((err) =>
          logger.error({ err, mediaCommand }, 'ycloud: falló el comando de envío directo'),
        );
        return reply.code(200).send({ ok: true });
      }

      // Si es un eco tuyo pero no matcheó ningún comando conocido, lo
      // logueamos tal cual llegó — para poder ver, la próxima vez que un
      // comando "no funcione", si fue un typo, autocorrección del celular,
      // u otra cosa.
      logUnmatchedEcho(request.body);

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
    // Los números de coexistencia tienen un límite de ~5 mensajes por
    // segundo: una pausa chica entre envíos evita que WhatsApp los rechace
    // por velocidad en tandas grandes (ej. /inku con 25 archivos). Y si UN
    // archivo falla, no frenamos el resto — lo logueamos y seguimos, para
    // no dejar a medio mandar un catálogo por un solo ítem con problemas.
    const items = media ?? [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      try {
        const res = await sendYCloudMessage({
          to: externalContactId,
          type: item.type,
          payload: { link: item.url, ...(item.caption ? { caption: item.caption } : {}) },
        });
        lastId = res.whatsappMessage?.id ?? res.id ?? lastId;
      } catch (err) {
        logger.error({ err, url: item.url, to: externalContactId }, 'ycloud: falló el envío de un archivo, sigo con el resto');
      }
      if (i < items.length - 1) await sleep(250);
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
 * YCloud manda el mensaje en `whatsappInboundMessage`. El bot no puede VER
 * fotos/videos/documentos, pero cuando el cliente reenvía uno CON TEXTO
 * (ej. reenvía la foto de un modelo con el nombre y precio escritos abajo),
 * ese texto es información real que antes se perdía del todo: un mensaje
 * que no era `type: "text"` se descartaba entero, caption incluido. Ahora
 * ese caption se pasa como texto, aclarando explícitamente que es la
 * descripción de algo que el bot no puede ver — así no inventa que "vio"
 * la foto, pero sí puede usar el dato (ej. el nombre del modelo).
 *
 * Si la cuenta de YCloud tiene más de un número de WhatsApp dado de alta
 * (varios negocios en la misma cuenta), TODOS mandan sus eventos al mismo
 * webhook. Por eso filtramos por `to` === nuestro YCLOUD_FROM_NUMBER: así
 * este bot ignora los mensajes de clientes de otro negocio/número.
 */
export function parseInbound(payload: unknown): NormalizedMessage | null {
  const p = payload as {
    type?: string;
    whatsappInboundMessage?: InboundMessage;
  };
  const m = p?.whatsappInboundMessage;
  if (!m?.from) return null;
  if (m.to && m.to !== ycloudEnv.YCLOUD_FROM_NUMBER) return null;

  const text = extractInboundText(m);
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

interface InboundMessage {
  id?: string;
  from?: string;
  to?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string };
  customerProfile?: { name?: string };
}

const ETIQUETA_POR_TIPO: Record<string, string> = {
  image: 'una foto',
  video: 'un video',
  document: 'un archivo',
};

function extractInboundText(m: InboundMessage): string {
  if (m.type === 'text') return (m.text?.body ?? '').trim();

  const etiqueta = m.type ? ETIQUETA_POR_TIPO[m.type] : undefined;
  if (!etiqueta) return ''; // audio, sticker, ubicación, etc.: sin texto útil, se ignora.

  const caption = (m.type === 'image' ? m.image?.caption : m.type === 'video' ? m.video?.caption : m.document?.caption)
    ?.trim();

  if (caption) {
    return `[El cliente mandó ${etiqueta} que VOS NO PODÉS VER, con este texto escrito junto a ella: "${caption}". Nunca digas que "viste" la foto/video — solo tenés ese texto, usalo para entender a qué modelo se refiere.]`;
  }
  return `[El cliente mandó ${etiqueta} sin ningún texto. No podés verla. Si no tenés suficiente contexto en la conversación para saber de qué modelo se trata, preguntale directamente qué modelo o capacidad es, no asumas.]`;
}

interface AgentControlCommand {
  externalContactId: string;
  enable: boolean;
}

/**
 * Detecta /nn y /ss en el evento de eco `whatsapp.smb.message.echoes`
 * (mensajes que vos mandaste a mano desde la app, no vía la API). Cualquier
 * otro texto tuyo (una respuesta normal a un cliente) devuelve null y sigue
 * de largo sin tocar nada — por eso son comandos exactos y no "cualquier
 * mensaje tuyo pausa el bot": así no hay riesgo de pausar por accidente.
 *
 * También filtra por `from` === nuestro número, por si la cuenta de YCloud
 * tiene más de un número dado de alta (ver nota en parseInbound).
 */
function parseAgentControl(payload: unknown): AgentControlCommand | null {
  const p = payload as {
    type?: string;
    whatsappMessage?: { from?: string; to?: string; text?: { body?: string } };
  };
  if (p?.type !== 'whatsapp.smb.message.echoes') return null;
  if (p.whatsappMessage?.from && p.whatsappMessage.from !== ycloudEnv.YCLOUD_FROM_NUMBER) return null;

  const to = p.whatsappMessage?.to;
  const body = (p.whatsappMessage?.text?.body ?? '').trim().toLowerCase();
  if (!to || !(body in AGENT_CONTROL_COMMANDS)) return null;

  return { externalContactId: to, enable: AGENT_CONTROL_COMMANDS[body]! };
}

/**
 * Loguea el texto exacto de un eco tuyo que no coincidió con ningún comando
 * (ni AGENT_CONTROL_COMMANDS ni MEDIA_COMMANDS) — así, si un comando "no
 * funciona", se puede ver acá qué llegó realmente (typo, autocorrección,
 * mayúsculas con algo raro, etc.) en vez de que quede en silencio total.
 */
function logUnmatchedEcho(payload: unknown): void {
  const p = payload as { type?: string; whatsappMessage?: { to?: string; text?: { body?: string } } };
  if (p?.type !== 'whatsapp.smb.message.echoes') return;

  const body = p.whatsappMessage?.text?.body ?? '';
  if (!body.trim().startsWith('/')) return; // solo nos interesan los que PARECEN un comando

  logger.warn(
    { to: p.whatsappMessage?.to, body },
    'ycloud: eco con pinta de comando pero no matcheó ninguno (revisar typo/autocorrección)',
  );
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

interface MediaCommand {
  externalContactId: string;
  productKey: string;
  eventId: string;
}

/**
 * Mismo mecanismo de detección que parseAgentControl (eco de
 * whatsapp.smb.message.echoes), pero para los MEDIA_COMMANDS.
 */
function parseMediaCommand(payload: unknown): MediaCommand | null {
  const p = payload as {
    type?: string;
    whatsappMessage?: { id?: string; from?: string; to?: string; text?: { body?: string } };
  };
  if (p?.type !== 'whatsapp.smb.message.echoes') return null;
  if (p.whatsappMessage?.from && p.whatsappMessage.from !== ycloudEnv.YCLOUD_FROM_NUMBER) return null;

  const to = p.whatsappMessage?.to;
  const body = (p.whatsappMessage?.text?.body ?? '').trim().toLowerCase();
  const productKey = MEDIA_COMMANDS[body];
  if (!to || !productKey) return null;

  // Id del mensaje si lo manda YCloud; si no, uno sintético por ventana de
  // 10s (to+comando) para no reenviar todo el catálogo si YCloud reintega
  // el webhook por una respuesta lenta.
  const eventId = p.whatsappMessage?.id ?? `synthetic-${to}-${body}-${Math.floor(Date.now() / 10_000)}`;

  return { externalContactId: to, productKey, eventId };
}

async function sendMediaCommand(command: MediaCommand, ctx: ChannelContext): Promise<void> {
  const fresh = await ctx.store.markEventSeen('ycloud-media-command', command.eventId);
  if (!fresh) {
    logger.info({ eventId: command.eventId }, 'ycloud: comando de media repetido (reintento), ignorado');
    return;
  }

  const product = ctx.config.products.find((p) => p.key === command.productKey);
  if (!product || product.media.length === 0) {
    logger.warn({ key: command.productKey }, 'ycloud: comando de media sin contenido cargado en products');
    return;
  }

  await ycloudAdapter.sendOutbound({ externalContactId: command.externalContactId, text: '', media: product.media });
  logger.info(
    { to: command.externalContactId, key: command.productKey, items: product.media.length },
    'ycloud: comando de envío directo ejecutado',
  );
}
