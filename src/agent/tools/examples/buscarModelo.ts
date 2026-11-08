import { loadConfig } from '../../../config.js';
import { positiveNumber, text } from '../../args.js';
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
        'Busca el modelo de incubadora más cercano a una capacidad de huevos Y le manda sus fotos/videos al cliente — no hace falta llamar a send_product_media aparte para el modelo principal, esta herramienta ya lo hace. Usala SIEMPRE que necesites dar un precio, o responder si un modelo es FULL AUTOMÁTICA o no (el campo "fullAutomatica" que devuelve es el dato exacto, no lo busques en otro lado) — nunca calcules ni recuerdes nada de memoria. Si el cliente no dio un número exacto (dijo "el más grande", "una mediana", capacidad en palabras, etc.), convertilo vos a un número aproximado antes de llamarla. Si hay más de un modelo con la misma capacidad (ej. "24" normal y "24 MICROPLUS"), pasá codigo_modelo y/o precio_aprox para que elija el correcto en vez de adivinar.',
      parameters: {
        type: 'object',
        properties: {
          capacidad_huevos: {
            type: 'number',
            description: 'Cantidad de huevos que busca el cliente (aproximada si no fue exacta).',
          },
          codigo_modelo: {
            type: 'string',
            description:
              'Si el cliente nombró una línea/código específico junto con la capacidad (ej. "HHD", "OVNI", "OVNIPLUS", "MICROPLUS", "RCAIM", "PIEDRA", "METAL"), pasalo acá tal cual. Desempata entre modelos de la misma capacidad — sin esto, un empate se resuelve eligiendo el modelo más básico/económico por defecto, que puede NO ser el que preguntó el cliente.',
          },
          precio_aprox: {
            type: 'number',
            description:
              'Si el cliente mencionó un precio junto con la capacidad (aunque lo haya recordado mal o aproximado, ej. "la de 24h a 340"), pasalo acá. También desempata entre modelos de la misma capacidad, eligiendo el que tenga el precio más parecido al que dijo.',
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

    const codigoModelo = text(args.codigo_modelo)?.toUpperCase();
    const precioAprox = positiveNumber(args.precio_aprox);

    const ordenado = [...catalogo].sort(
      (a, b) => Math.abs(a.capacidad - capacidad) - Math.abs(b.capacidad - capacidad),
    );

    // Varios modelos pueden empatar en la misma distancia a la capacidad
    // pedida (ej. "24" y "24 MICROPLUS" están los dos a distancia 0 de "24
    // huevos") — sin más pistas, por defecto gana el primero del catálogo
    // (el modelo más básico/económico), pero si el cliente nombró un código
    // de línea o un precio, los usamos para desempatar al correcto en vez
    // de adivinar.
    const distanciaMinima = Math.abs(ordenado[0]!.capacidad - capacidad);
    const empatados = ordenado.filter((m) => Math.abs(m.capacidad - capacidad) === distanciaMinima);

    let masCercano: (typeof empatados)[number] | undefined;
    if (empatados.length > 1 && codigoModelo) {
      masCercano = empatados.find((m) => m.linea.toUpperCase().includes(codigoModelo));
    }
    if (!masCercano && empatados.length > 1 && precioAprox) {
      masCercano = [...empatados].sort(
        (a, b) => Math.abs(a.precio - precioAprox) - Math.abs(b.precio - precioAprox),
      )[0];
    }
    if (!masCercano) masCercano = empatados[0]!;

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
