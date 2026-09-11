import { loadConfig } from '../../../config.js';
import { text } from '../../args.js';
import type { Tool } from '../index.js';

/**
 * Ejemplo de herramienta que lee datos: busca en la base de conocimiento del
 * agent.yaml por palabras clave. Es un RAG-lite; para algo serio, reemplazá
 * esta búsqueda por embeddings + una base vectorial (pgvector, etc.).
 */
export const searchKnowledge: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        'Busca información de la empresa (horarios, precios, políticas, FAQ) en la base de conocimiento. Usala ANTES de decir que no sabés algo.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Qué buscar, en pocas palabras.' } },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  async run(args) {
    const q = text(args.query);
    if (!q) return { results: [], note: 'Falta el término de búsqueda.' };

    const { knowledge } = loadConfig();
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);

    const results = knowledge
      .map((entry) => ({ entry, score: terms.filter((t) => entry.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.entry);

    return {
      results,
      note: results.length
        ? 'Respondé con esto, en tus palabras.'
        : 'Sin coincidencias. Decí con honestidad que lo vas a consultar.',
    };
  },
};
