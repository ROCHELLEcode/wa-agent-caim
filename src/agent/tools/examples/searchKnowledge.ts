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
    // length > 2 para descartar conectores cortos ("de", "el"...), pero los
    // números SIEMPRE se quedan aunque tengan 1-2 dígitos (06, 12, 24, 50...)
    // porque son justo lo que distingue un modelo de otro.
    const terms = q
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2 || /\d/.test(t));

    // \b...\b (límite de palabra), no "contains": si no, buscar "50" también
    // "matchea" dentro del precio "S/250" de otro modelo y ensucia el ranking.
    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const termRegexes = terms.map((t) => new RegExp(`\\b${escapeRegex(t)}\\b`));

    const results = knowledge
      .map((entry) => {
        const lower = entry.toLowerCase();
        return { entry, score: termRegexes.filter((re) => re.test(lower)).length };
      })
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
