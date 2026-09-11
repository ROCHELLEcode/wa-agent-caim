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

    ctx.media.push(...product.media);
    return { ok: true, sent: product.media.length };
  },
};
