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
/** Compara por palabra exacta, no por substring: "OVNI" no debe matchear
 * "OVNIPLUS" (son líneas distintas), algo que `linea.includes(codigo)` sí
 * confundía. */
function matchesCodigo(linea: string, codigo: string): boolean {
  return linea.toUpperCase().split(/\s+/).includes(codigo);
}

/**
 * El cliente dice "micro" (forma corta/coloquial), no "MICROPLUS" — y no
 * podemos confiar en que la IA siempre normalice bien la palabra exacta del
 * catálogo antes de llamar a la herramienta. Para no depender de eso, acá
 * se resuelve en código: si el código que llega no matchea ningún modelo
 * tal cual, se prueba por un alias conocido antes de rendirse.
 */
const ALIAS_CODIGO: Record<string, string> = {
  MICRO: 'MICROPLUS',
};

function normalizarCodigo(codigo: string): string {
  return ALIAS_CODIGO[codigo] ?? codigo;
}

export const buscarModelo: Tool = {
  definition: {
    type: 'function',
    function: {
      name: 'buscar_modelo',
      description:
        'Busca el modelo de incubadora más cercano a una capacidad de huevos Y le manda sus fotos/videos al cliente — no hace falta llamar a send_product_media aparte para el modelo principal, esta herramienta ya lo hace. Usala SIEMPRE que necesites dar un precio, o responder si un modelo es FULL AUTOMÁTICA o no (el campo "fullAutomatica" que devuelve es el dato exacto, no lo busques en otro lado) — nunca calcules ni recuerdes nada de memoria. Si el cliente no dio un número exacto (dijo "el más grande", "una mediana", capacidad en palabras, etc.), convertilo vos a un número aproximado antes de llamarla. Si el cliente nombró una línea/código (ej. "24 MICROPLUS", o la forma corta "micro"), pasá SIEMPRE codigo_modelo — la línea tiene prioridad sobre la capacidad: si esa línea no tiene exactamente esa capacidad, te devuelve el modelo más cercano DENTRO de esa misma línea, nunca uno de otra línea aunque sea numéricamente más cercano al número pedido.',
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
              'Pasalo SIEMPRE que el cliente haya mencionado, en cualquier mensaje de la conversación (incluido el texto/caption de una foto reenviada), una línea específica — tiene PRIORIDAD sobre capacidad_huevos. Códigos válidos: "HHD", "OVNI", "OVNIPLUS", "MICROPLUS", "RCAIM", "PIEDRA", "METAL". El cliente puede decir la forma corta/coloquial (ej. "micro" en vez de "MICROPLUS") — pasala igual, no hace falta que sea el nombre exacto del catálogo. Nunca ofrezcas una línea distinta a la que el cliente ya nombró solo porque tenga una capacidad más parecida.',
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

    const codigoModeloCrudo = text(args.codigo_modelo)?.toUpperCase();
    const codigoModelo = codigoModeloCrudo ? normalizarCodigo(codigoModeloCrudo) : undefined;
    const precioAprox = positiveNumber(args.precio_aprox);

    // Si el cliente nombró una línea (ej. MICROPLUS), esa línea tiene
    // PRIORIDAD ABSOLUTA sobre la capacidad: se filtra el catálogo a esa
    // línea ANTES de buscar la capacidad más cercana, no solo para
    // desempatar. Antes, un pedido de "20 huevos en este modelo" (MICROPLUS)
    // terminaba recomendando OVNIPLUS 18 porque esa quedaba numéricamente
    // más cerca del 20, ignorando por completo la línea que el cliente ya
    // había indicado.
    //
    // El match es por TOKEN exacto (no substring): "OVNI" no debe matchear
    // "OVNIPLUS" (son líneas distintas), por eso partimos `linea` en
    // palabras en vez de usar `.includes()`.
    let base = catalogo;
    let lineaFiltrada = false;
    if (codigoModelo) {
      const filtrado = catalogo.filter((m) => matchesCodigo(m.linea, codigoModelo));
      if (filtrado.length > 0) {
        base = filtrado;
        lineaFiltrada = true;
      }
    }

    const ordenado = [...base].sort(
      (a, b) => Math.abs(a.capacidad - capacidad) - Math.abs(b.capacidad - capacidad),
    );

    // Dentro de la línea ya filtrada (o del catálogo entero si no se dio
    // código) puede haber más de un modelo empatado en distancia a la
    // capacidad pedida — ahí sí desempatamos por precio_aprox si lo dieron,
    // y si no, gana el primero del catálogo (el más básico/económico).
    const distanciaMinima = Math.abs(ordenado[0]!.capacidad - capacidad);
    const empatados = ordenado.filter((m) => Math.abs(m.capacidad - capacidad) === distanciaMinima);

    let masCercano: (typeof empatados)[number] | undefined;
    if (!lineaFiltrada && empatados.length > 1 && codigoModelo) {
      masCercano = empatados.find((m) => matchesCodigo(m.linea, codigoModelo));
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
      // false cuando se pidió un código de línea y esa línea NO tiene
      // exactamente esa capacidad — avisale al cliente que le estás dando
      // el más cercano DENTRO de esa línea, no asumas que es exacto.
      capacidad_exacta: masCercano.capacidad === capacidad,
      fotos_videos_enviados: nuevos.length,
      otras_opciones_cercanas: ordenado
        .filter((m) => m.key !== masCercano!.key && clasificar(m) === seccionDelMasCercano)
        .slice(0, 3)
        .map((m) => ({ ...m, nombre: nombreModelo(m) })),
    };
  },
};
