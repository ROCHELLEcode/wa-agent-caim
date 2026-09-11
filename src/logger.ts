import { pino } from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // En producción se captura stdout como JSON; en local lo queremos legible.
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-webhook-secret"]',
      'req.headers["x-hub-signature-256"]',
      'headers.authorization',
      '*.apiKey',
      '*.token',
      '*.secret',
    ],
    censor: '[redactado]',
  },
});

export type Logger = typeof logger;
