import { env } from '../env.js';
import type { ConversationStore } from './store.js';

/**
 * Crea el store según STORE. Usa import dinámico a propósito: así el camino
 * `memory` no importa db/client.ts (que exige DATABASE_URL) y el demo corre
 * sin Postgres.
 */
export async function createStore(): Promise<ConversationStore> {
  if (env.STORE === 'postgres') {
    const { PostgresStore } = await import('./postgres.js');
    return new PostgresStore();
  }
  const { MemoryStore } = await import('./memory.js');
  return new MemoryStore();
}

export type { ConversationStore } from './store.js';
