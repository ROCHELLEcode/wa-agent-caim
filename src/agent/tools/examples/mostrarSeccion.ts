import { loadConfig } from '../../../config.js';
import { text } from '../../args.js';
import type { Tool } from '../index.js';
import { clasificar, type Seccion } from '../catalogoSecciones.js';

const NOMBRE: Record<Seccion, string> = {
  pequenos: 'pequeños (6 a 56 huevos)',
  piedra: 'grandes — línea PIEDRA (64 a 256 huevos)',
  metal: 'industriales — línea METAL (180 a 1056 huevos)',
};

/**
 * Cuando el cliente da una capacidad vaga o un rango (no un número puntual),
 * manda TODOS los modelos de la sección correspondiente, una foto + precio
 * por modelo, sin otra descripción — un panorama rápido para que el cliente
 * vea opciones y elija. Calculado en código sobre `catalogo`, no por
 * criterio del modelo.
 *
 * Tres secciones, no dos: "pequeños" es todo hasta 56 huevos. PIEDRA es la
 * sección "grande" por defecto. METAL es aparte — solo se manda si el
 * cliente la pide puntualmente (nunca por defecto al pedir "algo grande").
 */
export const mostrarSeccion: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'mostrar_seccion',
      description:
        'Manda TODOS los modelos de una sección con foto y precio, sin descripción extra, para que el cliente vea el panorama y elija. "pequenos" = hasta 56 huevos. "piedra" = la línea PIEDRA (64 a 256), es la sección "grande" por defecto — usala para pedidos vagos tipo "algo grande" o "muchos huevos". "metal" = la línea METAL (180 a 1056, industrial) — SOLO usala si el cliente menciona "metal" explícitamente o pide algo más grande que 256 huevos; nunca la mandes solo porque pidieron "grande" en general.',
      parameters: {
        type: 'object',
        properties: {
          seccion: {
            type: 'string',
            enum: ['pequenos', 'piedra', 'metal'],
            description: 'Qué sección mostrar.',
          },
        },
        required: ['seccion'],
        additionalProperties: false,
      },
    },
  },
  async run(args, ctx) {
    const seccionPedida = text(args.seccion);
    if (seccionPedida !== 'pequenos' && seccionPedida !== 'piedra' && seccionPedida !== 'metal') {
      return { error: 'seccion debe ser "pequenos", "piedra" o "metal".' };
    }

    const { catalogo, products } = loadConfig();
    const modelos = catalogo.filter((m) => clasificar(m) === seccionPedida).sort((a, b) => a.capacidad - b.capacidad);

    // La línea PIEDRA comparte una foto "general" entre sus 4 capacidades —
    // si tomáramos siempre la primera imagen de cada modelo, colisionarían
    // en la misma URL y se perderían capacidades del panorama. Por eso, por
    // cada modelo buscamos la primera imagen que todavía no usamos acá.
    const urlsUsadas = new Set(ctx.media.map((m) => m.url));
    let fotosEnviadas = 0;
    for (const modelo of modelos) {
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
      seccion: NOMBRE[seccionPedida],
      modelos: modelos.map((m) => ({ linea: m.linea, capacidad: m.capacidad, precio: m.precio, agotado: m.agotado })),
      fotos_enviadas: fotosEnviadas,
    };
  },
};
