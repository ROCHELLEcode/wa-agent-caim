import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import type { ChannelAdapter, ChannelContext } from '../types.js';

/**
 * Canal WEB: una mini UI de chat para probar el agente en el navegador, sin
 * WhatsApp ni base de datos. Es `inline` (request/respuesta), así que no usa
 * la cola de Redis. También sirve de ejemplo de cómo conectar tu propia app.
 */
export const webAdapter: ChannelAdapter = {
  name: 'web',
  mode: 'inline',

  async registerRoutes(app: FastifyInstance, ctx: ChannelContext): Promise<void> {
    // Sirve la carpeta web/ (la UI) en la raíz.
    await app.register(fastifyStatic, { root: path.resolve(process.cwd(), 'web'), prefix: '/' });

    // La app web postea acá y recibe la respuesta del agente en el acto.
    app.post('/chat', async (request, reply) => {
      const body = (request.body ?? {}) as { sessionId?: string; text?: string };
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const sessionId = typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : 'anon';
      if (!text) return reply.code(400).send({ error: 'texto vacío' });

      const answer = await ctx.runInline({
        externalContactId: `web:${sessionId}`,
        externalConversationId: `web:${sessionId}`,
        text,
        isInbound: true,
      });

      return reply.send({ reply: answer ?? '' });
    });

    logger.info(`canal web listo → abrí http://localhost:${env.PORT} para chatear`);
  },

  // El web responde en la misma llamada HTTP, no necesita enviar por fuera.
  async sendOutbound() {
    return {};
  },
};
