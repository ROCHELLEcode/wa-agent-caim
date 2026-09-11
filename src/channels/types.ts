import type { FastifyInstance } from 'fastify';
import type { AgentConfig } from '../config.js';
import type { ConversationStore } from '../memory/store.js';

/**
 * La abstracción central del kit. El "cerebro" del agente es siempre el mismo;
 * el ADAPTADOR DE CANAL lo conecta con dónde llegan los mensajes (WhatsApp
 * Cloud API, GHL, Chatwoot, YCloud, tu app web…).
 *
 * Un adaptador hace tres cosas: recibir (parsear el webhook a un mensaje
 * normalizado), enviar (mandar la respuesta), y montar sus rutas HTTP.
 */

/** Un mensaje, ya traducido a la forma común, venga del canal que venga. */
export interface NormalizedMessage {
  externalContactId: string;
  externalConversationId?: string | null;
  externalMessageId?: string | null;
  text: string;
  phone?: string | null;
  name?: string | null;
  email?: string | null;
  isInbound: boolean;
  metadata?: Record<string, unknown>;
}

/** Lo que el runtime le da al adaptador para procesar mensajes. */
export interface ChannelContext {
  store: ConversationStore;
  config: AgentConfig;
  enqueue(message: NormalizedMessage): Promise<void>;
  runInline(message: NormalizedMessage): Promise<string | null>;
}

/** Una foto o video que el bot puede mandar (además del texto). */
export interface MediaItem {
  url: string;
  type: 'image' | 'video';
  caption?: string;
}

export interface SendOutboundInput {
  externalContactId: string;
  text: string;
  externalConversationId?: string | null;
  media?: MediaItem[];
}

export interface ChannelAdapter {
  readonly name: string;
  readonly mode: 'queue' | 'inline';
  registerRoutes(app: FastifyInstance, ctx: ChannelContext): void | Promise<void>;
  sendOutbound(input: SendOutboundInput): Promise<{ messageId?: string }>;
}
