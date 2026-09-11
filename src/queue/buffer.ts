import { randomUUID } from 'node:crypto';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { redis } from '../redis/client.js';
import { buildJobId } from './jobId.js';
import { JOB_REPLY, messageQueue } from './queues.js';

/**
 * Debounce de mensajes. La gente no manda un mensaje, manda cuatro seguidos.
 * Responder a cada uno delata al bot y lo deja sin contexto. Acá se acumulan en
 * Redis y se responde UNA vez, MESSAGE_DEBOUNCE_MS después del último.
 *
 * (Solo lo usan los canales por webhook. El canal web responde en línea.)
 */

const TTL = 3_600;
const LOCK_MS = 120_000;

const bufKey = (id: string) => `wak:buf:${id}`;
const seqKey = (id: string) => `wak:seq:${id}`;
const pendKey = (id: string) => `wak:pend:${id}`;
const lockKey = (id: string) => `wak:lock:${id}`;

/** Agrega el texto al buffer y (re)programa la respuesta. */
export async function enqueueMessage(conversationId: string, contactId: string, text: string): Promise<void> {
  await redis.multi().rpush(bufKey(conversationId), text).expire(bufKey(conversationId), TTL).exec();
  await cancelPending(conversationId);

  const seq = await redis.incr(seqKey(conversationId));
  await redis.expire(seqKey(conversationId), TTL);
  const jobId = buildJobId(conversationId, seq);

  await messageQueue.add(JOB_REPLY, { conversationId, contactId }, { jobId, delay: env.MESSAGE_DEBOUNCE_MS });
  await redis.set(pendKey(conversationId), jobId, 'EX', TTL);
  logger.debug({ conversationId, jobId }, 'mensaje encolado');
}

/** Cancela la respuesta programada que todavía no arrancó (el debounce). */
async function cancelPending(conversationId: string): Promise<void> {
  const jobId = await redis.get(pendKey(conversationId));
  if (!jobId) return;
  try {
    const job = await messageQueue.getJob(jobId);
    if (!job) return;
    const state = await job.getState();
    if (state === 'delayed' || state === 'waiting') await job.remove();
  } catch (err) {
    logger.debug({ err, conversationId, jobId }, 'no se pudo cancelar el trabajo pendiente');
  }
}

/** Saca todo el buffer y lo deja vacío. */
export async function drainBuffer(conversationId: string): Promise<string[]> {
  const result = await redis.multi().lrange(bufKey(conversationId), 0, -1).del(bufKey(conversationId)).exec();
  return (result?.[0]?.[1] as string[] | undefined) ?? [];
}

export async function bufferHasMessages(conversationId: string): Promise<boolean> {
  return (await redis.llen(bufKey(conversationId))) > 0;
}

/** Lock por conversación: dos turnos a la vez cruzarían respuestas. */
export async function takeLock(conversationId: string): Promise<string | null> {
  const token = randomUUID();
  const ok = await redis.set(lockKey(conversationId), token, 'PX', LOCK_MS, 'NX');
  return ok ? token : null;
}

const RELEASE_LOCK_LUA = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  else
    return 0
  end
`;

export async function releaseLock(conversationId: string, token: string): Promise<void> {
  try {
    await redis.eval(RELEASE_LOCK_LUA, 1, lockKey(conversationId), token);
  } catch (err) {
    logger.warn({ err, conversationId }, 'no se pudo liberar el lock; vence solo');
  }
}

/** Reprograma un turno sin pasar por el debounce (el buffer ya tiene datos). */
export async function reschedule(conversationId: string, contactId: string, delayMs: number): Promise<void> {
  const seq = await redis.incr(seqKey(conversationId));
  const jobId = buildJobId(conversationId, seq);
  await messageQueue.add(JOB_REPLY, { conversationId, contactId }, { jobId, delay: delayMs });
  await redis.set(pendKey(conversationId), jobId, 'EX', TTL);
}
