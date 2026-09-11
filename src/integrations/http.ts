import { logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  /** 429 y 5xx son transitorios: vale la pena reintentar. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface RequestJsonOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  context?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch con timeout, reintentos con backoff exponencial y errores tipados.
 * Lo usan los adaptadores de canal: las APIs se caen o rate-limitean y no
 * queremos perder un mensaje por eso.
 */
export async function requestJson<T>(url: string, options: RequestJsonOptions = {}): Promise<T> {
  const { body, timeoutMs = 15_000, retries = 2, context = 'http', headers, ...rest } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...rest,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        const err = new HttpError(`${context}: ${res.status} ${res.statusText}`, res.status, text.slice(0, 2_000));
        if (err.retryable && attempt < retries) {
          lastError = err;
          const wait = 500 * 2 ** attempt;
          logger.warn({ url, status: res.status, attempt, wait }, `${context}: reintentando`);
          await sleep(wait);
          continue;
        }
        throw err;
      }

      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      lastError = err;
      if (attempt < retries) {
        const wait = 500 * 2 ** attempt;
        logger.warn({ url, err, attempt, wait }, `${context}: error de red, reintentando`);
        await sleep(wait);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}
