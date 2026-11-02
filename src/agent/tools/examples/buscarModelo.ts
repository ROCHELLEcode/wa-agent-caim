import { loadConfig } from '../../../config.js';
import { positiveNumber } from '../../args.js';
import type { Tool } from '../index.js';

/**
 * Busca el/los modelo(s) cuya capacidad (en huevos) está más cerca de la
 * pedida, calculado en código sobre `catalogo` (config/agent.yaml) — no por
 * búsqueda de texto. Así el precio que da el bot es siempre exacto, sin
 * importar cómo el cliente escriba la capacidad (en número, en palabras, o
 * de forma vaga tipo "el más grande").
 */
export const buscarModelo: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'buscar_modelo',
      description:
        'Busca el modelo de incubadora más cercano a una capacidad de huevos. Usala SIEMPRE que necesites dar un precio — nunca calcules ni recuerdes un precio de memoria. Si el cliente no dio un número exacto (dijo "el más grande", "una mediana", capacidad en palabras, etc.), convertilo vos a un número aproximado antes de llamarla.',
      parameters: {
        type: 'object',
        properties: {
          capacidad_huevos: {
            type: 'number',
            description: 'Cantidad de huevos que busca el cliente (aproximada si no fue exacta).',
          },
        },
        required: ['capacidad_huevos'],
        additionalProperties: false,
      },
    },
  },
  async run(args) {
    const capacidad = positiveNumber(args.capacidad_huevos);
    if (!capacidad) return { error: 'Falta capacidad_huevos.' };

    const { catalogo } = loadConfig();
    if (catalogo.length === 0) return { error: 'No hay catálogo cargado.' };

    const ordenado = [...catalogo].sort(
      (a, b) => Math.abs(a.capacidad - capacidad) - Math.abs(b.capacidad - capacidad),
    );

    return {
      mas_cercano: ordenado[0],
      otras_opciones_cercanas: ordenado.slice(1, 4),
    };
  },
};
