import type OpenAI from 'openai';
import type { ConversationStore } from '../../memory/store.js';
import type { MediaItem } from '../../channels/types.js';

/**
 * Una herramienta = una función que el LLM puede decidir llamar. Definís su
 * schema (lo que ve el modelo) y su `run` (lo que pasa cuando la llama).
 *
 * Para agregar la tuya: copiá una de tools/examples/, registrala en el array
 * `defaultTools` de abajo, y listo. El runner se encarga del resto.
 */

/** Lo que recibe una herramienta además de sus argumentos. */
export interface ToolContext {
  contactId: string;
  conversationId: string;
  contactName: string | null;
  store: ConversationStore;
  media: MediaItem[];
}

export interface Tool {
  definition: OpenAI.Chat.Completions.ChatCompletionTool;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

import { getCurrentTime } from './examples/getCurrentTime.js';
import { searchKnowledge } from './examples/searchKnowledge.js';
import { sendProductMedia } from './examples/sendProductMedia.js';
import { derivarAAsesor } from './examples/derivarAAsesor.js';

/** Las herramientas que el agente tiene disponibles. Sumá las tuyas acá. */
export const defaultTools: Tool[] = [getCurrentTime, searchKnowledge, sendProductMedia, derivarAAsesor];
