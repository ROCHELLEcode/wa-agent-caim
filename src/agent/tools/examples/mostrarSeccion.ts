import { loadConfig } from '../../../config.js';
import { positiveNumber } from '../../args.js';
import type { Tool } from '../index.js';

/** Hasta esta capacidad (inclusive) es "pequeños"; de ahí para arriba, "grandes". */
const LIMITE_PEQUENOS = 56;

/**
 * Cuando el cliente da una capacidad vaga o un rango (no un número puntual),
 * manda TODOS los modelos de la sección correspondiente (pequeños: hasta 56
 * huevos; grandes: PIEDRA y METAL), uno foto + precio por modelo, sin otra
 * descripción — un panorama rápido para que el cliente vea opciones y elija.
 * Calculado en código sobre `catalogo`, no por criterio del modelo.
 */
export const mostrarSeccion: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'mostrar_seccion',
      description:
        'Manda TODOS los modelos de la sección (pequeños hasta 56 huevos, o grandes PIEDRA/METAL) con foto y precio, sin descripción extra. Usala cuando el cliente da una capacidad vaga o un RANGO (ej. "entre 16 y 20 huevos", "una chica", "algo grande") en vez de un número puntual — así ve el panorama completo de esa sección antes de elegir. Si en cambio pidió una capacidad EXACTA, usá buscar_modelo en vez de esta.',
      parameters: {
        type: 'object',
        properties: {
          capacidad_referencia: {
            type: 'number',
            description: 'La capacidad que mencionó el cliente (o cualquier valor dentro del rango que dio), para saber qué sección mostrar.',
          },
        },
        required: ['capacidad_referencia'],
        additionalProperties: false,
      },
    },
  },
  async run(args, ctx) {
    const capacidad = positiveNumber(args.capacidad_referencia);
    if (!capacidad) return { error: 'Falta capacidad_referencia.' };

    const { catalogo, products } = loadConfig();
    const esPequenos = capacidad <= LIMITE_PEQUENOS;
    const seccion = catalogo
      .filter((m) => (esPequenos ? m.capacidad <= LIMITE_PEQUENOS : m.capacidad > LIMITE_PEQUENOS))
      .sort((a, b) => a.capacidad - b.capacidad);

    // Ojo: la línea PIEDRA comparte una foto "general" entre sus 4
    // capacidades — si tomáramos siempre la primera imagen de cada modelo,
    // las 4 colisionarían en la misma URL y solo se mandaría una (perdiendo
    // 128/192/256 del panorama). Por eso, por cada modelo buscamos la
    // primera imagen que TODAVÍA no usamos en este mismo panorama.
    const urlsUsadas = new Set(ctx.media.map((m) => m.url));
    let fotosEnviadas = 0;
    for (const modelo of seccion) {
      const product = products.find((p) => p.key === modelo.key);
      const foto = product?.media.find((m) => m.type === 'image' && !urlsUsadas.has(m.url));
      if (!foto) continue;

      urlsUsadas.add(foto.url);
      ctx.media.push({
        url: foto.url,
        type: 'image',
        caption: `${modelo.linea} huevos - S/${modelo.precio}${modelo.agotado ? ' (AGOTADO)' : ''}`,
      });
      fotosEnviadas++;
    }

    return {
      ok: true,
      seccion: esPequenos ? 'pequeños (hasta 56 huevos)' : 'grandes (PIEDRA y METAL)',
      modelos: seccion.map((m) => ({ linea: m.linea, capacidad: m.capacidad, precio: m.precio, agotado: m.agotado })),
      fotos_enviadas: fotosEnviadas,
    };
  },
};
