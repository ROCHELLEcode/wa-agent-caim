import path from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import { logger } from './logger.js';
import { loadConfig } from './config.js';
import { makeChannelContext } from './channels/ingest.js';
import type { ChannelAdapter } from './channels/types.js';
import type { ConversationStore } from './memory/store.js';

/** El body crudo, para verificar firmas HMAC (p.ej. Meta Cloud API). */
export type RequestWithRawBody = FastifyRequest & { rawBody?: Buffer };

export async function buildServer(store: ConversationStore, adapter: ChannelAdapter): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // El proxy de Coolify termina TLS; sin esto request.ip sería el del proxy.
    trustProxy: true,
    bodyLimit: 1_048_576,
  });

  // Guardamos el body crudo además del parseado: algunos canales firman el
  // cuerpo (HMAC) y necesitan los bytes exactos, no el JSON re-serializado.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as RequestWithRawBody).rawBody = body as Buffer;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Sirve public/media/ en /media/<archivo> — así send_product_media puede
  // usar links propios (https://TU-DOMINIO/media/foto.jpg) sin depender de
  // subir los archivos a un repo público de GitHub.
  await app.register(fastifyStatic, { root: path.resolve(process.cwd(), 'public/media'), prefix: '/media/' });

  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  app.get('/health/ready', async (_req, reply) => {
    const checks: Record<string, string> = { channel: adapter.name, store: env.STORE };
    let ok = true;

    if (env.STORE === 'postgres') {
      try {
        const { pool } = await import('./db/client.js');
        await pool.query('SELECT 1');
        checks.postgres = 'ok';
      } catch (err) {
        checks.postgres = err instanceof Error ? err.message : 'error';
        ok = false;
      }
    }

    if (adapter.mode === 'queue') {
      try {
        const { redis } = await import('./redis/client.js');
        await redis.ping();
        checks.redis = 'ok';
      } catch (err) {
        checks.redis = err instanceof Error ? err.message : 'error';
        ok = false;
      }
    }

    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });

  const ctx = makeChannelContext(store, loadConfig(), adapter.name);
  await adapter.registerRoutes(app, ctx);

  return app;
}
