import { Redis } from 'ioredis';
import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Conexiones a Redis. Solo se importan desde el camino "encolado" (canales por
 * webhook). El canal `web` y el chat de terminal no tocan este módulo, así que
 * el demo corre sin Redis.
 *
 * BullMQ exige `maxRetriesPerRequest: null` en las conexiones de sus workers,
 * así que compartimos esa config para todo.
 */
function createRedis(name: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  client.on('error', (err) => logger.error({ err, name }, 'error de conexión con Redis'));
  return client;
}

export const redis = createRedis('general');
export const queueConnection = createRedis('bullmq-queue');
export const workerConnection = createRedis('bullmq-worker');

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), queueConnection.quit(), workerConnection.quit()]);
}
