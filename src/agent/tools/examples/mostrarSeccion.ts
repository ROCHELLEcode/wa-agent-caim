import { loadConfig } from '../../../config.js';
import { text } from '../../args.js';
import type { Tool } from '../index.js';
import { clasificar, nombreModelo, type Seccion } from '../catalogoSecciones.js';

const NOMBRE: Record<Seccion, string> = {
  pequenos: 'pequeños (6 a 56 huevos)',
  piedra: 'grandes — línea PIEDRA (64 a 256 huevos)',
  metal: 'industriales — línea METAL (180 a 1056 huevos)',
};

/**
 * Al final del panorama de "pequeños" (pedido de info genérico), de yapa
 * también se mandan 5 videos fijos — pedido explícito del negocio, no a
 * criterio del modelo: 1 de la máquina de 24 huevos, 1 de la línea
 * MICROPLUS, 1 de la 56 RCAIM y 2 de la línea PIEDRA. Los videos de
 * MICROPLUS y PIEDRA son el mismo archivo compartido entre varias
 * capacidades de esa línea, así que se sacan de una capacidad
 * representativa (24 MICROPLUS y PIEDRA 64) — el contenido es el mismo sin
 * importar de cuál capacidad se lo saque.
 */
const VIDEOS_FINALES: { key: string; cantidad: number; etiqueta: string }[] = [
  { key: 'incubadora_24', cantidad: 1, etiqueta: '24 huevos' },
  { key: 'incubadora_24_microplus', cantidad: 1, etiqueta: 'MICROPLUS' },
  { key: 'incubadora_56_rcaim', cantidad: 1, etiqueta: '56 huevos RCAIM' },
  { key: 'incubadora_piedra_64', cantidad: 2, etiqueta: 'PIEDRA' },
];

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
        'Manda TODOS los modelos de una sección con foto y precio, sin descripción extra, para que el cliente vea el panorama y elija. "pequenos" = hasta 56 huevos (al final de estas fotos, de yapa, también manda un adelanto con foto y precio de PIEDRA 64 y PIEDRA 128, y 5 videos fijos — 1 de 24 huevos, 1 de MICROPLUS, 1 de 56 RCAIM y 2 de PIEDRA — no hace falta que llames aparte a send_product_media para nada de esto). "piedra" = la línea PIEDRA (64 a 256), es la sección "grande" por defecto — usala para pedidos vagos tipo "algo grande" o "muchos huevos". "metal" = la línea METAL (180 a 1056, industrial) — SOLO usala si el cliente menciona "metal" explícitamente o pide algo más grande que 256 huevos; nunca la mandes solo porque pidieron "grande" en general.',
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
        caption: `${nombreModelo(modelo)} - S/${modelo.precio}${modelo.agotado ? ' (AGOTADO)' : ''}`,
      });
      fotosEnviadas++;
    }

    // La sección "pequeños" es la que se manda ante un pedido de info
    // totalmente genérico — ahí aprovechamos para dar también un adelanto de
    // las dos líneas PIEDRA más chicas (64 y 128), para que el cliente sepa
    // que hay opciones más grandes sin tener que preguntar. Es SOLO un
    // adelanto (una foto + precio cada una), no el panorama PIEDRA completo.
    // Usamos la ÚLTIMA imagen de cada producto (la foto propia de esa
    // capacidad), no la primera: la primera es "piedra-general.jpeg", una
    // foto compartida entre las 4 capacidades PIEDRA con una descripción
    // larga pegada — no sirve para un adelanto corto con precio.
    const previewGrandes: { linea: string; capacidad: number; precio: number }[] = [];
    if (seccionPedida === 'pequenos') {
      for (const key of ['incubadora_piedra_64', 'incubadora_piedra_128']) {
        const modelo = catalogo.find((m) => m.key === key);
        const product = products.find((p) => p.key === key);
        if (!modelo || !product) continue;

        const fotosDelProducto = product.media.filter((m) => m.type === 'image');
        const foto = fotosDelProducto[fotosDelProducto.length - 1];
        if (!foto || urlsUsadas.has(foto.url)) continue;

        urlsUsadas.add(foto.url);
        ctx.media.push({
          url: foto.url,
          type: 'image',
          caption: `${nombreModelo(modelo)} - S/${modelo.precio}${modelo.agotado ? ' (AGOTADO)' : ''}`,
        });
        fotosEnviadas++;
        previewGrandes.push({ linea: modelo.linea, capacidad: modelo.capacidad, precio: modelo.precio });
      }
    }

    const videosEnviados: string[] = [];
    if (seccionPedida === 'pequenos') {
      for (const { key, cantidad, etiqueta } of VIDEOS_FINALES) {
        const product = products.find((p) => p.key === key);
        const videos = (product?.media ?? [])
          .filter((m) => m.type === 'video' && !urlsUsadas.has(m.url))
          .slice(0, cantidad);

        for (const video of videos) {
          urlsUsadas.add(video.url);
          ctx.media.push({ url: video.url, type: 'video', caption: `Video: ${etiqueta}` });
          fotosEnviadas++;
          videosEnviados.push(etiqueta);
        }
      }
    }

    return {
      ok: true,
      seccion: NOMBRE[seccionPedida],
      modelos: modelos.map((m) => ({ linea: m.linea, capacidad: m.capacidad, precio: m.precio, agotado: m.agotado })),
      preview_modelos_grandes: previewGrandes,
      videos_enviados: videosEnviados,
      fotos_enviadas: fotosEnviadas,
    };
  },
};
