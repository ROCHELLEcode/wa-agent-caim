import { Worker, type Job } from 'bullmq';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { workerConnection } from '../redis/client.js';
import { runAgent } from '../agent/runner.js';
import type { AgentConfig } from '../config.js';
import type { ConversationStore } from '../memory/store.js';
import type { ChannelAdapter } from '../channels/types.js';
import { MESSAGE_QUEUE, type MessageJob } from './queues.js';
import { bufferHasMessages, drainBuffer, releaseLock, reschedule, takeLock } from './buffer.js';

const CONCURRENCY = 5;

async function processTurn(
  job: Job<MessageJob>,
  store: ConversationStore,
  config: AgentConfig,
  adapter: ChannelAdapter,
): Promise<void> {
  const { conversationId, contactId } = job.data;

  const token = await takeLock(conversationId);
  if (!token) {
    await reschedule(conversationId, contactId, 3_000);
    return;
  }

  try {
    const conversation = await store.findConversation(conversationId);
    if (!conversation) return;
    if (!conversation.agentEnabled) {
      await drainBuffer(conversationId);
      return;
    }

    const texts = await drainBuffer(conversationId);
    if (texts.length === 0) return;

    const contact = await store.getContact(contactId);
    if (!contact) return;

    logger.info({ conversationId, messages: texts.length }, 'procesando turno');

    const { reply, media } = await runAgent({ store, conversation, contact, userText: texts.join('\n'), config });
    await store.touchLastMessage(conversationId);

    if (!reply && media.length === 0) return;
    if (!env.AGENT_REPLY_ENABLED) {
      logger.info({ conversationId, reply }, 'AGENT_REPLY_ENABLED=false: respuesta no enviada');
      return;
    }

    await adapter.sendOutbound({
      externalContactId: contact.externalId,
      text: reply ?? '',
      externalConversationId: conversation.externalId,
      media,
    });
  } finally {
    await releaseLock(conversationId, token);
  }

  if (await bufferHasMessages(conversationId)) {
    await reschedule(conversationId, contactId, env.MESSAGE_DEBOUNCE_MS);
  }
}

export function startWorker(store: ConversationStore, config: AgentConfig, adapter: ChannelAdapter): Worker<MessageJob> {
  const worker = new Worker<MessageJob>(MESSAGE_QUEUE, (job) => processTurn(job, store, config, adapter), {
    connection: workerConnection,
    concurrency: CONCURRENCY,
  });

  worker.on('failed', (job, err) =>
    logger.error({ err, jobId: job?.id, conversationId: job?.data?.conversationId }, 'falló un turno'),
  );
  worker.on('error', (err) => logger.error({ err }, 'error del worker'));

  logger.info({ concurrency: CONCURRENCY, channel: adapter.name }, 'worker de mensajes iniciado');
  return worker;
}
