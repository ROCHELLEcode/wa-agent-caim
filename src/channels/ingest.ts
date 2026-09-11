import { createHash } from 'node:crypto';
import type { AgentConfig } from '../config.js';
import { runAgent } from '../agent/runner.js';
import type { ConversationStore } from '../memory/store.js';
import type { ChannelContext, NormalizedMessage } from './types.js';

const DEDUPE_WINDOW_MS = 60_000;

/**
 * Id de idempotencia sintético para cuando el canal no manda un id de mensaje.
 * Contacto + texto + ventana de 1 minuto: un reintento cae en la misma ventana
 * y se descarta; el mismo texto diez minutos después entra bien.
 */
function synthEventId(contactId: string, text: string): string {
  const window = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  const hash = createHash('sha256').update(`${contactId}|${text}|${window}`).digest('hex');
  return `synthetic-${hash.slice(0, 32)}`;
}

/**
 * Arma el ChannelContext: encapsula el pipeline común (idempotencia, upsert de
 * contacto/conversación, encolado o ejecución en línea) para que cada adaptador
 * solo se ocupe de parsear y enviar.
 */
export function makeChannelContext(
  store: ConversationStore,
  config: AgentConfig,
  providerName: string,
): ChannelContext {
  return {
    store,
    config,

    async enqueue(message: NormalizedMessage): Promise<void> {
      if (!message.isInbound) return;
      const text = message.text.trim();
      if (!text) return;

      const eventId = message.externalMessageId ?? synthEventId(message.externalContactId, text);
      const fresh = await store.markEventSeen(providerName, eventId);
      if (!fresh) return; // reintento del proveedor

      const contact = await store.upsertContact({
        externalId: message.externalContactId,
        phone: message.phone,
        name: message.name,
        email: message.email,
        metadata: message.metadata,
      });
      const conversation = await store.getOrCreateConversation(contact.id, message.externalConversationId ?? null);
      if (!conversation.agentEnabled) return; // un humano tomó la charla

      // Import dinámico: así los canales inline (web) nunca cargan Redis.
      const { enqueueMessage } = await import('../queue/buffer.js');
      await enqueueMessage(conversation.id, contact.id, text);
    },

    async runInline(message: NormalizedMessage): Promise<string | null> {
      const contact = await store.upsertContact({
        externalId: message.externalContactId,
        name: message.name,
      });
      const conversation = await store.getOrCreateConversation(contact.id, message.externalConversationId ?? null);
      if (!conversation.agentEnabled) return null;

      const { reply } = await runAgent({ store, conversation, contact, userText: message.text.trim(), config });
      await store.touchLastMessage(conversation.id);
      return reply;
    },
  };
}
