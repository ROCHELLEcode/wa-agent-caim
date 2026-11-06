import { loadConfig } from '../../../config.js';
import { positiveNumber } from '../../args.js';
import type { Tool } from '../index.js';
import { clasificar, nombreModelo } from '../catalogoSecciones.js';

/**
 * Busca el/los modelo(s) cuya capacidad (en huevos) está más cerca de la
 * pedida, calculado en código sobre `catalogo` (config/agent.yaml) — no por
 * búsqueda de texto. Así el precio que da el bot es siempre exacto, sin
 * importar cómo el cliente escriba la capacidad (en número, en palabras, o
 * de forma vaga tipo "el más grande"). Las alternativas que devuelve son
 * siempre de la MISMA sección que el modelo más cercano (pequeños,
 * PIEDRA o METAL) — nunca mezcla, por ejemplo, una PIEDRA con una METAL
 * como "cercana" (METAL es su propia categoría, aparte).
 *
 * TAMBIÉN manda de una las fotos/videos del modelo más cercano (igual que
 * send_product_media) — así no depende de que el modelo haga una segunda
 * llamada aparte, que en la práctica a veces se "olvidaba" de hacer y el
 * cliente se quedaba sin fotos.
 */
export const buscarModelo: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'buscar_modelo',
      description:
        'Busca el modelo de incubadora más cercano a una capacidad de huevos Y le manda sus fotos/videos al cliente — no hace falta llamar a send_product_media aparte para el modelo principal, esta herramienta ya lo hace. Usala SIEMPRE que necesites dar un precio — nunca calcules ni recuerdes un precio de memoria. Si el cliente no dio un número exacto (dijo "el más grande", "una mediana", capacidad en palabras, etc.), convertilo vos a un número aproximado antes de llamarla.',
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
  async run(args, ctx) {
    const capacidad = positiveNumber(args.capacidad_huevos);
    if (!capacidad) return { error: 'Falta capacidad_huevos.' };

    const { catalogo, products } = loadConfig();
    if (catalogo.length === 0) return { error: 'No hay catálogo cargado.' };

    const ordenado = [...catalogo].sort(
      (a, b) => Math.abs(a.capacidad - capacidad) - Math.abs(b.capacidad - capacidad),
    );
    const masCercano = ordenado[0]!;
    const seccionDelMasCercano = clasificar(masCercano);

    const product = products.find((p) => p.key === masCercano.key);
    const yaEnColados = new Set(ctx.media.map((m) => m.url));
    const nuevos = (product?.media ?? []).filter((m) => !yaEnColados.has(m.url));
    ctx.media.push(...nuevos);

    return {
      mas_cercano: { ...masCercano, nombre: nombreModelo(masCercano) },
      fotos_videos_enviados: nuevos.length,
      otras_opciones_cercanas: ordenado
        .filter((m) => m.key !== masCercano.key && clasificar(m) === seccionDelMasCercano)
        .slice(0, 3)
        .map((m) => ({ ...m, nombre: nombreModelo(m) })),
    };
  },
};
