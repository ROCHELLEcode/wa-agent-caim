import { loadConfig } from '../../../config.js';
import { text } from '../../args.js';
import type { Tool } from '../index.js';

/**
 * Manda fotos/videos de un producto (o de otro contenido, como el envío a
 * provincia). Las claves y archivos disponibles se cargan de agent.yaml
 * (products: [{ key, media: [{ url, type, caption }] }]).
 */
const { products } = loadConfig();
const productKeys = products.map((p) => p.key);

/**
 * Secuencias largas (fotos + descripción) que NO hay que repetir si ya se
 * mandaron antes en la conversación — a diferencia de un modelo de
 * incubadora puntual, que sí puede volver a pedirse. Ver `alreadySent` en
 * ToolContext (runner.ts arma esto con el historial).
 */
const NO_REPETIR = new Set(['metodos_pago', 'ubicacion']);

export const sendProductMedia: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'send_product_media',
      description:
        `Manda por WhatsApp la foto o el video de un producto (o del envío a provincia). Usala cuando el cliente pida ver fotos, video, o cómo se ve algo. Claves disponibles: ${
          productKeys.length ? productKeys.join(', ') : '(ninguna cargada todavía)'
        }.`,
      parameters: {
        type: 'object',
        properties: {
          product_key: {
            type: 'string',
            ...(productKeys.length > 0 ? { enum: productKeys } : {}),
            description: 'La clave exacta del producto o contenido a mandar.',
          },
        },
        required: ['product_key'],
        additionalProperties: false,
      },
    },
  },
  async run(args, ctx) {
    const key = text(args.product_key);
    if (!key) return { error: 'Falta product_key.' };

    const product = products.find((p) => p.key === key);
    if (!product || product.media.length === 0) {
      return { error: `No hay fotos/videos cargados para "${key}". No inventes que los mandaste.` };
    }

    if (NO_REPETIR.has(key) && ctx.alreadySent.has(key)) {
      return {
        ok: false,
        ya_enviado_antes: true,
        nota:
          'Esto ya se lo mandaste al cliente antes en esta misma conversación — NO se reenvía. ' +
          'Si la pregunta del cliente tiene respuesta puntual en el knowledge (buscala con search_knowledge), ' +
          'respondé SOLO esa respuesta puntual, corta, por texto, sin volver a mandar fotos ni repetir toda la descripción. ' +
          'Si no encontrás la respuesta o no entendés la pregunta, llamá a stay_silent y no escribas nada.',
      };
    }

    // Si el modelo llama la herramienta dos veces (misma key, o una distinta
    // que comparte algún archivo) en el mismo turno, no duplicamos el envío:
    // un archivo ya puesto en cola para esta respuesta no se vuelve a mandar.
    const yaEnColados = new Set(ctx.media.map((m) => m.url));
    const nuevos = product.media.filter((m) => !yaEnColados.has(m.url));
    ctx.media.push(...nuevos);

    if (nuevos.length === 0) {
      return { ok: true, sent: 0, note: `Ya habías mandado todo "${key}" en este mismo mensaje, no se repitió.` };
    }
    return { ok: true, sent: nuevos.length };
  },
};
